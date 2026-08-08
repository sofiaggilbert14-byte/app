package com.charmiptv.app

import android.util.Xml
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

class EpgNativeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val database = EpgDatabase(reactContext)

  // Refresh/network/XML work is intentionally isolated from guide reads. A slow
  // EPG download must never queue getWindow/getCurrent behind it; WAL lets the
  // query executor keep serving the last-good live table until the final swap.
  private val refreshExecutor = Executors.newSingleThreadExecutor()
  private val queryExecutor = Executors.newFixedThreadPool(2)

  private val currentCacheLock = Any()
  private val currentCache = HashMap<String, NativeEpgProgram>()
  @Volatile private var currentCacheValidUntilMs = 0L

  override fun getName(): String = "CharmEpg"

  @ReactMethod
  fun refresh(url: String, promise: Promise) {
    refreshExecutor.execute {
      try {
        database.ensureHealthy()
        val now = System.currentTimeMillis()
        val minStop = now - GUIDE_HISTORY_MS
        val maxStart = now + GUIDE_WINDOW_MS
        val channelLogos = LinkedHashMap<String, String>()
        val channelNames = LinkedHashMap<String, String>()
        val channelIdsWithPrograms = LinkedHashSet<String>()
        val batches = streamProgramBatches(
          url,
          minStop,
          maxStart,
          channelLogos,
          channelNames,
          channelIdsWithPrograms,
        )
        database.replaceBatches(batches)

        // Soft guide epoch — independent of playlist last-good (no joint snapshot).
        // Persist aliases for SQL joins / future native rematch; JS still owns match policy.
        val aliases = ArrayList<Triple<String, String, String>>(channelNames.size + channelIdsWithPrograms.size)
        for ((channelId, displayName) in channelNames) {
          aliases.add(Triple(channelId, "display_name", displayName))
          aliases.add(Triple(channelId, "xmltv_id", channelId))
        }
        for (channelId in channelIdsWithPrograms) {
          aliases.add(Triple(channelId, "has_programs", channelId))
          if (!channelNames.containsKey(channelId)) {
            aliases.add(Triple(channelId, "xmltv_id", channelId))
          }
        }
        database.replaceChannelAliases(aliases)

        val guideEpoch = (database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L) + 1L
        database.setMeta("guide_epoch", guideEpoch.toString())
        database.setMeta("guide_refreshed_at", now.toString())

        val deleted = database.deleteExpired(now - GUIDE_HISTORY_MS)
        // Rare idle reclaim only after a large expiry — never every refresh.
        database.maybeIncrementalVacuum(MIN_VACUUM_DELETED_ROWS, deleted)
        rebuildCurrentCache(now)

        val logos = Arguments.createMap()
        for ((channelId, logoUrl) in channelLogos) {
          logos.putString(channelId, logoUrl)
        }
        val names = Arguments.createMap()
        for ((channelId, channelName) in channelNames) {
          names.putString(channelId, channelName)
        }
        val programIds = Arguments.createArray()
        for (channelId in channelIdsWithPrograms) {
          programIds.pushString(channelId)
        }

        val result = Arguments.createMap().apply {
          putDouble("count", database.count().toDouble())
          putDouble("windowStartMs", (now - GUIDE_HISTORY_MS).toDouble())
          putDouble("windowEndMs", maxStart.toDouble())
          putDouble("guideEpoch", guideEpoch.toDouble())
          putMap("channelLogos", logos)
          putMap("channelNames", names)
          putArray("channelIdsWithPrograms", programIds)
        }
        promise.resolve(result)
      } catch (t: Throwable) {
        promise.reject("EPG_REFRESH_FAILED", t.message ?: "Native EPG refresh failed", t)
      }
    }
  }

  @ReactMethod
  fun getWindow(startMs: Double, endMs: Double, channelIds: ReadableArray, promise: Promise) {
    queryExecutor.execute {
      try {
        val start = startMs.toLong()
        val end = endMs.toLong()
        if (end <= start || end - start > MAX_QUERY_WINDOW_MS) {
          throw IllegalArgumentException("Invalid EPG query window")
        }
        val ids = ArrayList<String>(channelIds.size())
        for (i in 0 until channelIds.size()) {
          val id = channelIds.getString(i)?.trim()
          if (!id.isNullOrEmpty()) ids.add(id)
        }
        val programmes = database.queryWindow(start, end, ids)
        promise.resolve(groupPrograms(programmes))
      } catch (t: Throwable) {
        promise.reject("EPG_WINDOW_FAILED", t.message ?: "Could not read native EPG window", t)
      }
    }
  }

  /**
   * Fast path for the TV guide: JOIN playlist_epg_matches → epg_programmes and
   * return programmes keyed by playlist channel id (not XMLTV id).
   */
  @ReactMethod
  fun queryGuideWindow(startMs: Double, endMs: Double, playlistChannelIds: ReadableArray, promise: Promise) {
    queryExecutor.execute {
      try {
        val start = startMs.toLong()
        val end = endMs.toLong()
        if (end <= start || end - start > MAX_QUERY_WINDOW_MS) {
          throw IllegalArgumentException("Invalid EPG query window")
        }
        val ids = ArrayList<String>(playlistChannelIds.size())
        for (i in 0 until playlistChannelIds.size()) {
          val id = playlistChannelIds.getString(i)?.trim()
          if (!id.isNullOrEmpty()) ids.add(id)
        }
        val programmes = database.queryGuideWindow(start, end, ids)
        promise.resolve(groupPrograms(programmes))
      } catch (t: Throwable) {
        promise.reject("EPG_GUIDE_WINDOW_FAILED", t.message ?: "Could not read joined EPG window", t)
      }
    }
  }

  @ReactMethod
  fun upsertPlaylistChannels(channels: ReadableArray, playlistEpoch: Double, promise: Promise) {
    refreshExecutor.execute {
      try {
        val rows = ArrayList<PlaylistChannelRow>(channels.size())
        for (i in 0 until channels.size()) {
          val map = channels.getMap(i) ?: continue
          val playlistId = map.getString("playlistId")?.trim().orEmpty()
          if (playlistId.isEmpty()) continue
          rows.add(
            PlaylistChannelRow(
              playlistId = playlistId,
              rawTvgId = map.getString("rawTvgId")?.trim().orEmpty(),
              name = map.getString("name")?.trim().orEmpty(),
              logo = map.getString("logo")?.trim().orEmpty(),
              groupTitle = map.getString("group")?.trim().orEmpty(),
            )
          )
        }
        database.replacePlaylistChannels(rows, playlistEpoch.toLong())
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_PLAYLIST_UPSERT_FAILED", t.message ?: "Could not upsert playlist channels", t)
      }
    }
  }

  @ReactMethod
  fun upsertPlaylistEpgMatches(matches: ReadableArray, guideEpoch: Double, promise: Promise) {
    refreshExecutor.execute {
      try {
        val rows = ArrayList<PlaylistEpgMatchRow>(matches.size())
        for (i in 0 until matches.size()) {
          val map = matches.getMap(i) ?: continue
          val playlistId = map.getString("playlistId")?.trim().orEmpty()
          if (playlistId.isEmpty()) continue
          rows.add(
            PlaylistEpgMatchRow(
              playlistId = playlistId,
              xmltvId = map.getString("xmltvId")?.trim().orEmpty(),
              logoXmltvId = map.getString("logoXmltvId")?.trim().orEmpty(),
              ambiguous = if (map.hasKey("ambiguous")) map.getBoolean("ambiguous") else false,
              matchPolicy = map.getString("matchPolicy")?.trim().orEmpty().ifEmpty { "full" },
              manual = if (map.hasKey("manual")) map.getBoolean("manual") else false,
            )
          )
        }
        database.replacePlaylistEpgMatches(rows, guideEpoch.toLong())
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_MATCH_UPSERT_FAILED", t.message ?: "Could not upsert EPG matches", t)
      }
    }
  }

  @ReactMethod
  fun getCurrent(promise: Promise) {
    queryExecutor.execute {
      try {
        val now = System.currentTimeMillis()
        if (now >= currentCacheValidUntilMs) rebuildCurrentCache(now)
        val snapshot = synchronized(currentCacheLock) { HashMap(currentCache) }
        val result = Arguments.createMap()
        for ((channelId, program) in snapshot) {
          result.putMap(channelId, programToMap(program))
        }
        promise.resolve(result)
      } catch (t: Throwable) {
        promise.reject("EPG_CURRENT_FAILED", t.message ?: "Could not read current EPG", t)
      }
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    refreshExecutor.execute {
      try {
        database.clear()
        synchronized(currentCacheLock) {
          currentCache.clear()
          currentCacheValidUntilMs = 0L
        }
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_CLEAR_FAILED", t.message ?: "Could not clear native EPG cache", t)
      }
    }
  }

  private fun rebuildCurrentCache(nowMs: Long) {
    val programmes = database.queryCurrent(nowMs)
    var earliestEnd = Long.MAX_VALUE
    val replacement = HashMap<String, NativeEpgProgram>(programmes.size)
    for (program in programmes) {
      replacement[program.channelId] = program
      if (program.endMs < earliestEnd) earliestEnd = program.endMs
    }
    val normalRefresh = nowMs + CURRENT_CACHE_REFRESH_MS
    val validUntil = if (earliestEnd == Long.MAX_VALUE) {
      normalRefresh
    } else {
      minOf(normalRefresh, maxOf(nowMs + 1_000L, earliestEnd))
    }
    synchronized(currentCacheLock) {
      currentCache.clear()
      currentCache.putAll(replacement)
      currentCacheValidUntilMs = validUntil
    }
  }

  private fun programToMap(program: NativeEpgProgram) = Arguments.createMap().apply {
    putString("channelId", program.channelId)
    putString("title", program.title)
    if (program.description != null) putString("description", program.description)
    else putNull("description")
    if (!program.category.isNullOrBlank()) putString("category", program.category)
    else putNull("category")
    putDouble("startMs", program.startMs.toDouble())
    putDouble("endMs", program.endMs.toDouble())
  }

  private fun groupPrograms(programmes: List<NativeEpgProgram>): WritableMap {
    val grouped = Arguments.createMap()
    val channelArrays = HashMap<String, WritableArray>()
    for (program in programmes) {
      val array = channelArrays.getOrPut(program.channelId) { Arguments.createArray() }
      array.pushMap(programToMap(program))
    }
    for ((channelId, array) in channelArrays) {
      grouped.putArray(channelId, array)
    }
    return grouped
  }

  private fun streamProgramBatches(
    url: String,
    minStop: Long,
    maxStart: Long,
    channelLogos: MutableMap<String, String>,
    channelNames: MutableMap<String, String>,
    channelIdsWithPrograms: MutableSet<String>,
  ): Sequence<List<NativeEpgProgram>> = sequence {
    openPossiblyGzipped(url).use { input ->
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

      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> when (parser.name) {
            "channel" -> {
              metadataChannelId = parser.getAttributeValue(null, "id")?.trim()?.takeIf { it.isNotEmpty() }
            }
            "display-name" -> {
              val id = metadataChannelId
              if (!id.isNullOrBlank() && !channelNames.containsKey(id)) {
                val displayName = parser.nextText().trim()
                if (displayName.isNotEmpty()) channelNames[id] = displayName
              }
            }
            "icon" -> {
              val id = metadataChannelId
              val src = parser.getAttributeValue(null, "src")?.trim()
              if (!id.isNullOrBlank() && !src.isNullOrBlank() && !channelLogos.containsKey(id)) {
                channelLogos[id] = src
              }
            }
            "programme" -> {
              channelId = parser.getAttributeValue(null, "channel")?.trim()
              startMs = parseXmltvTime(parser.getAttributeValue(null, "start"))
              // Match JS resolveXmltvStop: missing/invalid/absurd stop → +30 minutes.
              // Next-program inference runs once on staging after ingest.
              val parsedStop = parseXmltvTime(parser.getAttributeValue(null, "stop"))
              endMs = resolveProgrammeStop(startMs, parsedStop)
              keepProgram =
                !channelId.isNullOrBlank() &&
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
                channelIdsWithPrograms.add(id)
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
    val connection = URL(urlString).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 45_000
    connection.instanceFollowRedirects = true
    connection.setRequestProperty("User-Agent", "CharmIPTV/Experimental-v3")
    connection.setRequestProperty("Accept-Encoding", "gzip")
    connection.connect()
    if (connection.responseCode !in 200..299) {
      val status = connection.responseCode
      connection.disconnect()
      throw IllegalStateException("EPG HTTP $status")
    }

    try {
      val networkStream = object : FilterInputStream(connection.inputStream) {
        override fun close() {
          try {
            super.close()
          } finally {
            connection.disconnect()
          }
        }
      }
      val buffered = BufferedInputStream(networkStream, NETWORK_BUFFER_SIZE)
      buffered.mark(2)
      val b1 = buffered.read()
      val b2 = buffered.read()
      buffered.reset()

      return if (b1 == 0x1f && b2 == 0x8b) {
        GZIPInputStream(buffered, NETWORK_BUFFER_SIZE)
      } else {
        buffered
      }
    } catch (t: Throwable) {
      connection.disconnect()
      throw t
    }
  }

  private fun resolveProgrammeStop(startMs: Long, parsedStopMs: Long): Long {
    if (startMs <= 0L) return 0L
    if (
      parsedStopMs > startMs &&
      parsedStopMs - startMs <= MAX_PROGRAMME_DURATION_MS
    ) {
      return parsedStopMs
    }
    return startMs + DEFAULT_PROGRAMME_DURATION_MS
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
      if (month !in 1..12 || day !in 1..31 || hour !in 0..23 || minute !in 0..59 || second !in 0..59) {
        return 0L
      }

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
      var millis =
        epochDay * 86_400_000L +
          hour * 3_600_000L +
          minute * 60_000L +
          second * 1_000L

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
    synchronized(currentCacheLock) {
      currentCache.clear()
      currentCacheValidUntilMs = 0L
    }
    refreshExecutor.shutdownNow()
    queryExecutor.shutdownNow()
    database.close()
    super.invalidate()
  }

  companion object {
    private const val BATCH_SIZE = 1000
    private const val NETWORK_BUFFER_SIZE = 64 * 1024
    private const val GUIDE_HISTORY_MS = 6L * 60L * 60L * 1000L
    private const val GUIDE_WINDOW_MS = 24L * 60L * 60L * 1000L
    private const val MAX_QUERY_WINDOW_MS = 24L * 60L * 60L * 1000L
    private const val CURRENT_CACHE_REFRESH_MS = 30_000L
    private const val DEFAULT_PROGRAMME_DURATION_MS = 30L * 60L * 1000L
    private const val MAX_PROGRAMME_DURATION_MS = 24L * 60L * 60L * 1000L
    /** Only vacuum after a large expiry purge — never on every refresh. */
    private const val MIN_VACUUM_DELETED_ROWS = 5_000
  }
}