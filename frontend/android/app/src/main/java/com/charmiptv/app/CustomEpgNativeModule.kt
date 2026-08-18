package com.charmiptv.app

import android.util.Xml
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

/**
 * Custom XMLTV ownership path.
 *
 * TiViMate-style split:
 * - keep the complete XMLTV <channel> id/name directory for assignment browsing;
 * - keep programme rows only for XMLTV ids that are currently bound to playlist channels.
 *
 * The existing CharmEpg module remains authoritative for primary EPG joins/queries. This
 * module writes the same charm_epg_user_v1.db + epg_channel_bindings tables, so Guide reads
 * do not need a second source of truth.
 */
class CustomEpgNativeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val userDatabase = EpgDatabase(reactContext, USER_DATABASE)
  private val controlDao = EpgControlDatabase.get(reactContext).dao()
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "CharmCustomEpg"

  @ReactMethod
  fun setGuideChannelBinding(channelId: String, xmltvId: String, promise: Promise) {
    executor.execute {
      try {
        val channel = channelId.trim()
        val xmltv = xmltvId.trim()
        if (channel.isEmpty()) throw IllegalArgumentException("Channel id is empty")
        controlDao.setChannelBinding(USER_SOURCE_ID, channel, xmltv)
        promise.resolve(controlDao.channelBindingCount(USER_SOURCE_ID))
      } catch (t: Throwable) {
        promise.reject("CUSTOM_EPG_BINDING_FAILED", t.message ?: "Could not update custom Guide assignment", t)
      }
    }
  }

  @ReactMethod
  fun listUserGuideChannels(query: String, offset: Double, limit: Double, promise: Promise) {
    executor.execute {
      try {
        val page = userDatabase.listDisplayNameAliases(
          query,
          offset.toInt().coerceAtLeast(0),
          limit.toInt().coerceIn(1, 100),
        )
        val rows = Arguments.createArray()
        for (row in page.rows) rows.pushMap(Arguments.createMap().apply {
          putString("id", row.channelId)
          putString("name", row.displayName)
        })
        promise.resolve(Arguments.createMap().apply {
          putInt("total", page.total)
          putArray("rows", rows)
        })
      } catch (t: Throwable) {
        promise.reject("CUSTOM_EPG_DIRECTORY_FAILED", t.message ?: "Could not read custom Guide channels", t)
      }
    }
  }

  @ReactMethod
  fun refreshUserGuide(url: String, promise: Promise) {
    executor.execute {
      try {
        val sourceUrl = url.trim()
        if (sourceUrl.isEmpty()) throw IllegalArgumentException("Custom EPG URL is empty")
        if (!userDatabase.ensureHealthy()) throw IllegalStateException("Custom Guide database integrity check failed")
        userDatabase.assertRefreshStorageAvailable()

        val bindings = controlDao.allChannelBindings(USER_SOURCE_ID)
        val activeXmltvIds = LinkedHashSet<String>()
        for (binding in bindings) {
          binding.xmltvId.trim().takeIf { it.isNotEmpty() }?.let(activeXmltvIds::add)
        }

        val now = System.currentTimeMillis()
        val minStop = now - GUIDE_HISTORY_MS
        val maxStart = now + GUIDE_WINDOW_MS
        val channelNames = LinkedHashMap<String, String>()
        var acceptedProgrammeCount = 0L

        val batches = streamFilteredXmltv(
          sourceUrl = sourceUrl,
          activeXmltvIds = activeXmltvIds,
          minStop = minStop,
          maxStart = maxStart,
          channelNames = channelNames,
          onAcceptedProgramme = { acceptedProgrammeCount += 1L },
        )

        if (activeXmltvIds.isEmpty()) {
          // Consume the feed once so the full channel directory is indexed, but do not
          // let an empty binding set mean "all programmes" as the old parser did.
          for (ignored in batches) Unit
          userDatabase.clear()
        } else {
          try {
            // EpgDatabase stages batches and atomically swaps LIVE only after a valid
            // non-empty ingest, preserving the prior last-good guide on network/parser failure.
            userDatabase.replaceBatches(batches)
          } catch (t: IllegalStateException) {
            if (acceptedProgrammeCount > 0L) throw t
            // A valid XMLTV directory can legitimately have no current/future rows for the
            // selected ids. Keep last-good programmes, but still refresh the assignment list.
          }
        }

        val aliases = ArrayList<Triple<String, String, String>>(channelNames.size * 2)
        for ((channelId, displayName) in channelNames) {
          aliases.add(Triple(channelId, "display_name", displayName))
          aliases.add(Triple(channelId, "xmltv_id", channelId))
        }
        userDatabase.replaceChannelAliases(aliases)
        userDatabase.setMeta("guide_refreshed_at", now.toString())
        userDatabase.setMeta("custom_programme_scope", activeXmltvIds.size.toString())

        promise.resolve(Arguments.createMap().apply {
          putDouble("count", userDatabase.count().toDouble())
          putDouble("directoryCount", channelNames.size.toDouble())
          putDouble("bindingCount", activeXmltvIds.size.toDouble())
        })
      } catch (t: Throwable) {
        promise.reject("CUSTOM_EPG_REFRESH_FAILED", t.message ?: "Custom Guide refresh failed", t)
      }
    }
  }

  private fun streamFilteredXmltv(
    sourceUrl: String,
    activeXmltvIds: Set<String>,
    minStop: Long,
    maxStart: Long,
    channelNames: MutableMap<String, String>,
    onAcceptedProgramme: () -> Unit,
  ): Sequence<List<NativeEpgProgram>> = sequence {
    openPossiblyGzipped(sourceUrl).use { input ->
      val parser = Xml.newPullParser()
      parser.setInput(input, "UTF-8")
      val batch = ArrayList<NativeEpgProgram>(BATCH_SIZE)

      var event = parser.eventType
      var metadataChannelId: String? = null
      var channelId: String? = null
      var startMs = 0L
      var endMs = 0L
      var keepProgram = false
      var title = ""
      var description: String? = null
      var category: String? = null
      var rawProgrammeCount = 0L

      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> when (parser.name) {
            "channel" -> {
              metadataChannelId = parser.getAttributeValue(null, "id")?.trim()?.takeIf { it.isNotEmpty() }
            }
            "display-name" -> {
              val id = metadataChannelId
              if (!id.isNullOrBlank()) {
                val displayName = parser.nextText().trim()
                if (displayName.isNotEmpty() && !channelNames.containsKey(id)) {
                  channelNames[id] = displayName
                }
              }
            }
            "programme" -> {
              rawProgrammeCount += 1L
              if (rawProgrammeCount > MAX_PROGRAMME_COUNT) {
                throw IllegalStateException("Custom EPG exceeds programme safety limit")
              }
              channelId = parser.getAttributeValue(null, "channel")?.trim()
              startMs = parseXmltvTime(parser.getAttributeValue(null, "start"))
              val parsedStop = parseXmltvTime(parser.getAttributeValue(null, "stop"))
              endMs = resolveProgrammeStop(startMs, parsedStop)
              keepProgram =
                !channelId.isNullOrBlank() &&
                  channelId in activeXmltvIds &&
                  startMs > 0L &&
                  endMs > startMs &&
                  endMs >= minStop &&
                  startMs <= maxStart
              title = ""
              description = null
              category = null
            }
            "title" -> if (keepProgram) title = parser.nextText().trim()
            "desc" -> if (keepProgram) description = parser.nextText().trim().ifEmpty { null }
            "category" -> if (keepProgram && category.isNullOrBlank()) {
              category = parser.nextText().trim().ifEmpty { null }
            }
          }
          XmlPullParser.END_TAG -> when (parser.name) {
            "channel" -> metadataChannelId = null
            "programme" -> {
              val id = channelId
              if (keepProgram && !id.isNullOrBlank()) {
                onAcceptedProgramme()
                batch.add(
                  NativeEpgProgram(
                    channelId = id,
                    title = title.ifBlank { "No Information" },
                    description = description,
                    category = category,
                    startMs = startMs,
                    endMs = endMs,
                  )
                )
                if (batch.size >= BATCH_SIZE) {
                  yield(ArrayList(batch))
                  batch.clear()
                }
              }
              channelId = null
              keepProgram = false
            }
          }
        }
        event = parser.next()
      }
      if (batch.isNotEmpty()) yield(ArrayList(batch))
    }
  }

  private fun openPossiblyGzipped(urlString: String): InputStream {
    var currentUrl = URL(urlString)
    var redirects = 0
    while (true) {
      val scheme = currentUrl.protocol.lowercase(Locale.US)
      if (scheme != "http" && scheme != "https") {
        throw IllegalStateException("Custom EPG redirect used unsupported scheme: $scheme")
      }
      val connection = currentUrl.openConnection() as HttpURLConnection
      connection.connectTimeout = 15_000
      connection.readTimeout = 45_000
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("User-Agent", "CharmIPTV/Experimental-v3")
      connection.setRequestProperty("Accept", "*/*")
      connection.setRequestProperty("Accept-Encoding", "gzip")
      connection.connect()

      val status = connection.responseCode
      if (isRedirect(status)) {
        val location = connection.getHeaderField("Location")?.trim().orEmpty()
        connection.disconnect()
        if (location.isEmpty()) throw IllegalStateException("Custom EPG HTTP $status redirect missing Location")
        redirects += 1
        if (redirects > MAX_HTTP_REDIRECTS) throw IllegalStateException("Custom EPG redirect limit exceeded")
        currentUrl = URL(currentUrl, location)
        continue
      }
      if (status !in 200..299) {
        connection.disconnect()
        throw IllegalStateException("Custom EPG HTTP $status")
      }
      val declaredLength = connection.contentLengthLong
      if (declaredLength > MAX_COMPRESSED_EPG_BYTES) {
        connection.disconnect()
        throw IllegalStateException("Custom EPG exceeds compressed safety limit")
      }
      userDatabase.assertRefreshStorageAvailable(declaredLength)

      try {
        val connectionStream = object : FilterInputStream(connection.inputStream) {
          override fun close() {
            try { super.close() } finally { connection.disconnect() }
          }
        }
        val compressed = BoundedInputStream(connectionStream, MAX_COMPRESSED_EPG_BYTES)
        val buffered = BufferedInputStream(compressed, NETWORK_BUFFER_SIZE)
        buffered.mark(2)
        val b1 = buffered.read()
        val b2 = buffered.read()
        buffered.reset()
        val decoded = if (b1 == 0x1f && b2 == 0x8b) GZIPInputStream(buffered, NETWORK_BUFFER_SIZE) else buffered
        return BoundedInputStream(decoded, MAX_DECOMPRESSED_EPG_BYTES)
      } catch (t: Throwable) {
        connection.disconnect()
        throw t
      }
    }
  }

  private fun isRedirect(status: Int): Boolean =
    status == HttpURLConnection.HTTP_MOVED_PERM ||
      status == HttpURLConnection.HTTP_MOVED_TEMP ||
      status == HttpURLConnection.HTTP_SEE_OTHER || status == 307 || status == 308

  private fun resolveProgrammeStop(startMs: Long, parsedStopMs: Long): Long {
    if (startMs <= 0L) return 0L
    return if (parsedStopMs > startMs && parsedStopMs - startMs <= MAX_PROGRAMME_DURATION_MS) {
      parsedStopMs
    } else {
      startMs + DEFAULT_PROGRAMME_DURATION_MS
    }
  }

  private fun parseXmltvTime(raw: String?): Long {
    if (raw == null) return 0L
    val value = raw.trim()
    if (value.length < 14) return 0L
    return try {
      fun digits(offset: Int, count: Int): Int {
        var result = 0
        for (i in offset until offset + count) {
          val digit = value[i].code - '0'.code
          if (digit !in 0..9) throw NumberFormatException("Invalid XMLTV time")
          result = result * 10 + digit
        }
        return result
      }
      val year = digits(0, 4)
      val month = digits(4, 2)
      val day = digits(6, 2)
      val hour = digits(8, 2)
      val minute = digits(10, 2)
      val second = digits(12, 2)
      if (month !in 1..12 || day !in 1..31 || hour !in 0..23 || minute !in 0..59 || second !in 0..59) return 0L

      var y = year.toLong()
      val m = month.toLong()
      val d = day.toLong()
      y -= if (m <= 2L) 1L else 0L
      val era = Math.floorDiv(y, 400L)
      val yoe = y - era * 400L
      val mp = m + if (m > 2L) -3L else 9L
      val doy = (153L * mp + 2L) / 5L + d - 1L
      val doe = yoe * 365L + yoe / 4L - yoe / 100L + doy
      val epochDay = era * 146097L + doe - 719468L
      var millis = epochDay * 86_400_000L + hour * 3_600_000L + minute * 60_000L + second * 1_000L

      var i = 14
      while (i < value.length && value[i].isWhitespace()) i++
      if (i + 4 < value.length && (value[i] == '+' || value[i] == '-')) {
        val sign = if (value[i] == '-') -1 else 1
        val offsetHours = digits(i + 1, 2)
        val offsetMinutes = digits(i + 3, 2)
        if (offsetHours <= 23 && offsetMinutes <= 59) {
          millis -= sign * (offsetHours * 60L + offsetMinutes) * 60_000L
        }
      }
      millis
    } catch (_: Throwable) {
      0L
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    userDatabase.close()
    super.invalidate()
  }

  private class BoundedInputStream(input: InputStream, private val maxBytes: Long) : FilterInputStream(input) {
    private var bytesRead = 0L
    private fun account(count: Int): Int {
      if (count <= 0) return count
      bytesRead += count.toLong()
      if (bytesRead > maxBytes) throw IllegalStateException("Custom EPG exceeds size safety limit")
      return count
    }
    override fun read(): Int {
      val value = super.read()
      if (value >= 0) account(1)
      return value
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = account(super.read(buffer, offset, length))
  }

  companion object {
    private const val USER_DATABASE = "charm_epg_user_v1.db"
    private const val USER_SOURCE_ID = "user"
    private const val BATCH_SIZE = 1000
    private const val NETWORK_BUFFER_SIZE = 64 * 1024
    private const val MAX_HTTP_REDIRECTS = 6
    private const val MAX_COMPRESSED_EPG_BYTES = 256L * 1024L * 1024L
    private const val MAX_DECOMPRESSED_EPG_BYTES = 1024L * 1024L * 1024L
    private const val MAX_PROGRAMME_COUNT = 2_000_000L
    private const val GUIDE_HISTORY_MS = 6L * 60L * 60L * 1000L
    private const val GUIDE_WINDOW_MS = 72L * 60L * 60L * 1000L
    private const val DEFAULT_PROGRAMME_DURATION_MS = 30L * 60L * 1000L
    private const val MAX_PROGRAMME_DURATION_MS = 24L * 60L * 60L * 1000L
  }
}
