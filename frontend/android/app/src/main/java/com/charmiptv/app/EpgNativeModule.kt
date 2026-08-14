package com.charmiptv.app

import android.util.Xml
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

class EpgNativeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val database = EpgDatabase(reactContext)

  // Refresh/network/XML work is isolated from guide reads. A slow download or
  // parse never queues getWindow/queryGuideWindow behind it; WAL keeps the
  // last-good LIVE table readable until the final replacement succeeds.
  private val refreshExecutor = Executors.newSingleThreadExecutor()
  private val queryExecutor = Executors.newFixedThreadPool(2)

  private val currentCacheLock = Any()
  private val currentCache = HashMap<String, NativeEpgProgram>()
  @Volatile private var currentCacheValidUntilMs = 0L

  override fun getName(): String = "CharmEpg"

  @ReactMethod
  fun refresh(url: String, allowNotModified: Boolean, promise: Promise) {
    refreshExecutor.execute {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      try {
        database.ensureHealthy()
        database.assertRefreshStorageAvailable()
        val now = System.currentTimeMillis()
        val minStop = now - GUIDE_HISTORY_MS
        val maxStart = now + GUIDE_WINDOW_MS
        val channelLogos = LinkedHashMap<String, String>()
        val channelNames = LinkedHashMap<String, String>()
        var channelIdsWithPrograms = LinkedHashSet<String>()
        val httpValidators = EpgHttpValidators()
        var downloaded: DownloadedEpg? = null
        var parsedSourceCount = 0
        var retainedPrograms: List<NativeEpgProgram> = emptyList()

        try {
          // Phase 1: finish the complete HTTP download and fsync the local file.
          // No XML parsing begins while the network connection is still active.
          downloaded = downloadEpg(url, httpValidators, allowNotModified)

          // Phase 2: parse the completed local XML/XML.GZ from beginning to end
          // into one validated collection. There is deliberately no 1,000-row
          // yield/batch pipeline in this experimental branch.
          val parsed = parseCompleteLocalFile(
            downloaded.file,
            channelLogos,
            channelNames,
          )
          parsedSourceCount = parsed.size

          // Correct missing/overlapping stops while the full source ordering is
          // available, then keep the app's bounded guide window for SQLite/RAM.
          retainedPrograms = normalizeStopsAndRetain(parsed, minStop, maxStart)
          if (retainedPrograms.isEmpty()) {
            throw IllegalStateException("Refusing to replace live EPG with an empty retained guide")
          }
          channelIdsWithPrograms = retainedPrograms.mapTo(LinkedHashSet()) { it.channelId }

          // One complete collection enters staging as one transaction-sized
          // input. EpgDatabase still performs its atomic staging→LIVE swap and
          // preserves the previous last-good guide if anything fails.
          database.replaceBatches(sequenceOf(retainedPrograms))

        } catch (_: EpgNotModifiedException) {
          val guideEpoch = database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L
          val result = Arguments.createMap().apply {
            putDouble("count", database.count().toDouble())
            putDouble("windowStartMs", minStop.toDouble())
            putDouble("windowEndMs", maxStart.toDouble())
            putDouble("guideEpoch", guideEpoch.toDouble())
            putBoolean("notModified", true)
            putString("ingestMode", "download-complete-then-full-local-parse")
          }
          promise.resolve(result)
          return@execute
        } finally {
          downloaded?.file?.delete()
        }

        val aliases = ArrayList<Triple<String, String, String>>(channelNames.size + channelIdsWithPrograms.size)
        for ((channelId, displayName) in channelNames) {
          aliases.add(Triple(channelId, "display_name", displayName))
          aliases.add(Triple(channelId, "xmltv_id", channelId))
        }
        for (channelId in channelIdsWithPrograms) {
          aliases.add(Triple(channelId, "has_programs", channelId))
          if (!channelNames.containsKey(channelId)) aliases.add(Triple(channelId, "xmltv_id", channelId))
        }
        database.replaceChannelAliases(aliases)

        val guideEpoch = (database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L) + 1L
        database.setMeta("guide_epoch", guideEpoch.toString())
        database.setMeta("guide_refreshed_at", now.toString())
        database.setMeta(HTTP_SOURCE_HASH_KEY, httpValidators.sourceHash)
        database.setMeta(HTTP_ETAG_KEY, httpValidators.etag)
        database.setMeta(HTTP_LAST_MODIFIED_KEY, httpValidators.lastModified)

        // SQLite retains the complete provider feed. RAM receives only today's
        // active 12-hour slice so the parsed multi-day collection is not pinned
        // on the heap after refresh. Every channel is included in this slice.
        val activeRamStart = now - (now % HOUR_MS) - ACTIVE_GUIDE_HISTORY_MS
        val activeRamEnd = activeRamStart + ACTIVE_GUIDE_WINDOW_MS
        val activeRamPrograms = retainedPrograms.filter {
          it.endMs > activeRamStart && it.startMs < activeRamEnd
        }
        val ramRuntime = EpgRamRuntime.get(reactContext)
        if (ramRuntime.engine.replacePrograms(activeRamPrograms, activeRamStart, activeRamEnd)) {
          ramRuntime.warmGuideEpoch = guideEpoch
        } else {
          // Do not retain parser objects after a budget rejection. The RAM
          // module can rebuild the same bounded slice from authoritative SQLite.
          ramRuntime.engine.clear(0L)
          ramRuntime.warmGuideEpoch = -1L
        }

        val deleted = database.deleteExpired(minStop)
        database.maybeIncrementalVacuum(MIN_VACUUM_DELETED_ROWS, deleted)

        synchronized(currentCacheLock) {
          currentCache.clear()
          currentCacheValidUntilMs = 0L
        }

        val logos = Arguments.createMap()
        for ((channelId, logoUrl) in channelLogos) logos.putString(channelId, logoUrl)
        val names = Arguments.createMap()
        for ((channelId, channelName) in channelNames) names.putString(channelId, channelName)
        val programIds = Arguments.createArray()
        for (channelId in channelIdsWithPrograms) programIds.pushString(channelId)

        val result = Arguments.createMap().apply {
          putDouble("count", database.count().toDouble())
          putDouble("windowStartMs", minStop.toDouble())
          putDouble("windowEndMs", maxStart.toDouble())
          putDouble("guideEpoch", guideEpoch.toDouble())
          putString("ingestMode", "download-complete-then-full-local-parse")
          putDouble("downloadedBytes", (downloaded?.bytes ?: 0L).toDouble())
          putDouble("parsedSourceCount", parsedSourceCount.toDouble())
          putDouble("retainedProgramCount", retainedPrograms.size.toDouble())
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
        validateWindow(start, end)
        val ids = readIds(channelIds)
        promise.resolve(groupPrograms(database.queryWindow(start, end, ids)))
      } catch (t: Throwable) {
        promise.reject("EPG_WINDOW_FAILED", t.message ?: "Could not read native EPG window", t)
      }
    }
  }

  @ReactMethod
  fun queryGuideWindow(startMs: Double, endMs: Double, playlistChannelIds: ReadableArray, promise: Promise) {
    queryExecutor.execute {
      try {
        val start = startMs.toLong()
        val end = endMs.toLong()
        validateWindow(start, end)
        val ids = readIds(playlistChannelIds)
        promise.resolve(groupPrograms(database.queryGuideWindow(start, end, ids)))
      } catch (t: Throwable) {
        promise.reject("EPG_GUIDE_WINDOW_FAILED", t.message ?: "Could not read joined EPG window", t)
      }
    }
  }

  @ReactMethod
  fun isPlaylistCurrent(contentFingerprint: String, promise: Promise) {
    queryExecutor.execute {
      try {
        promise.resolve(database.playlistFingerprintMatches(contentFingerprint.trim()))
      } catch (t: Throwable) {
        promise.reject("EPG_PLAYLIST_FINGERPRINT_FAILED", t.message ?: "Could not read playlist fingerprint", t)
      }
    }
  }

  @ReactMethod
  fun upsertPlaylistChannels(
    channels: ReadableArray,
    playlistEpoch: Double,
    contentFingerprint: String,
    promise: Promise,
  ) {
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
        promise.resolve(database.replacePlaylistChannels(rows, playlistEpoch.toLong(), contentFingerprint.trim()))
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
        promise.resolve(database.replacePlaylistEpgMatches(rows, guideEpoch.toLong()))
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
        for ((channelId, program) in snapshot) result.putMap(channelId, programToMap(program))
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
        val ramRuntime = EpgRamRuntime.get(reactContext)
        ramRuntime.engine.clear(0L)
        ramRuntime.warmGuideEpoch = -1L
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

  private fun validateWindow(start: Long, end: Long) {
    if (end <= start || end - start > MAX_QUERY_WINDOW_MS) throw IllegalArgumentException("Invalid EPG query window")
  }

  private fun readIds(array: ReadableArray): List<String> {
    val ids = ArrayList<String>(array.size())
    for (i in 0 until array.size()) {
      val id = array.getString(i)?.trim()
      if (!id.isNullOrEmpty()) ids.add(id)
    }
    return ids
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
    val validUntil = if (earliestEnd == Long.MAX_VALUE) normalRefresh
    else minOf(normalRefresh, maxOf(nowMs + 1_000L, earliestEnd))
    synchronized(currentCacheLock) {
      currentCache.clear()
      currentCache.putAll(replacement)
      currentCacheValidUntilMs = validUntil
    }
  }

  private fun programToMap(program: NativeEpgProgram) = Arguments.createMap().apply {
    putString("channelId", program.channelId)
    putString("title", program.title)
    if (program.description != null) putString("description", program.description) else putNull("description")
    if (!program.category.isNullOrBlank()) putString("category", program.category) else putNull("category")
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
    for ((channelId, array) in channelArrays) grouped.putArray(channelId, array)
    return grouped
  }

  /**
   * Parse the entire completed local source into one collection. The parser
   * still uses XmlPullParser (constant XML tokenizer memory), but programme
   * objects are not yielded to SQLite in chunks. A hard heap-aware admission
   * limit protects Fire TV/Android TV if the provider feed unexpectedly grows.
   */
  private fun parseCompleteLocalFile(
    file: File,
    channelLogos: MutableMap<String, String>,
    channelNames: MutableMap<String, String>,
  ): List<NativeEpgProgram> {
    val runtime = Runtime.getRuntime()
    val usedBefore = heapUsed(runtime)
    val reserve = maxOf(48L * MIB, (runtime.maxMemory() * 0.24).toLong())
    val availableBudget = maxOf(16L * MIB, runtime.maxMemory() - usedBefore - reserve)
    val parseBudget = minOf(MAX_PARSED_PROGRAM_BYTES, availableBudget)
    if (usedBefore >= (runtime.maxMemory() * PARSE_REFUSE_FRACTION).toLong()) {
      throw IllegalStateException("Not enough free heap to parse the complete local EPG safely")
    }

    val programs = ArrayList<NativeEpgProgram>()
    var estimatedBytes = 0L
    var rawProgrammeCount = 0L

    openDownloadedFile(file).use { input ->
      val parser = Xml.newPullParser()
      parser.setInput(input, "UTF-8")

      var event = parser.eventType
      var metadataChannelId: String? = null
      var channelId: String? = null
      var startMs = 0L
      var endMs = 0L
      var title = ""
      var description: String? = null
      var category: String? = null

      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> when (parser.name) {
            "channel" -> metadataChannelId = parser.getAttributeValue(null, "id")?.trim()?.takeIf { it.isNotEmpty() }
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
              if (!id.isNullOrBlank() && !src.isNullOrBlank() && !channelLogos.containsKey(id)) channelLogos[id] = src
            }
            "programme" -> {
              rawProgrammeCount += 1L
              if (rawProgrammeCount > MAX_PROGRAMME_COUNT) {
                throw IllegalStateException("EPG contains more than $MAX_PROGRAMME_COUNT programmes; keeping last-good guide")
              }
              channelId = parser.getAttributeValue(null, "channel")?.trim()
              startMs = parseXmltvTime(parser.getAttributeValue(null, "start"))
              val parsedStop = parseXmltvTime(parser.getAttributeValue(null, "stop"))
              endMs = resolveProgrammeStop(startMs, parsedStop)
              title = ""
              description = null
              category = null
            }
            "title" -> if (!channelId.isNullOrBlank()) title = parser.nextText().trim()
            "desc" -> if (!channelId.isNullOrBlank()) description = parser.nextText().trim().ifEmpty { null }
            "category" -> if (!channelId.isNullOrBlank() && category.isNullOrBlank()) {
              category = parser.nextText().trim().ifEmpty { null }
            }
          }
          XmlPullParser.END_TAG -> when (parser.name) {
            "channel" -> metadataChannelId = null
            "programme" -> {
              val id = channelId
              if (!id.isNullOrBlank() && startMs > 0L && endMs > startMs) {
                val program = NativeEpgProgram(
                  channelId = id,
                  title = title.ifBlank { "No Information" },
                  description = description,
                  category = category,
                  startMs = startMs,
                  endMs = endMs,
                )
                estimatedBytes += estimateProgramBytes(program)
                if (estimatedBytes > parseBudget) {
                  throw IllegalStateException("Complete EPG parse exceeds the safe in-memory budget")
                }
                programs.add(program)
              }
              channelId = null
            }
          }
        }
        event = parser.next()
      }
    }

    if (programs.isEmpty()) throw IllegalStateException("EPG contained no valid programmes")
    programs.sortWith(compareBy<NativeEpgProgram> { it.channelId }.thenBy { it.startMs }.thenBy { it.endMs })
    return programs
  }

  private fun normalizeStopsAndRetain(
    source: List<NativeEpgProgram>,
    minStop: Long,
    maxStart: Long,
  ): List<NativeEpgProgram> {
    val retained = ArrayList<NativeEpgProgram>()
    for (index in source.indices) {
      val current = source[index]
      var end = current.endMs
      val next = source.getOrNull(index + 1)
      if (next != null && next.channelId == current.channelId && next.startMs > current.startMs) {
        val usedDefault = end == current.startMs + DEFAULT_PROGRAMME_DURATION_MS
        val overlapsNext = end > next.startMs
        val nextDuration = next.startMs - current.startMs
        if ((usedDefault || overlapsNext) && nextDuration in 1..MAX_PROGRAMME_DURATION_MS) end = next.startMs
      }
      if (end > minStop && current.startMs < maxStart) {
        // Reusing unchanged objects avoids retaining one extra NativeEpgProgram per channel.
        retained.add(if (end == current.endMs) current else current.copy(endMs = end))
      }
    }
    return retained
  }

  /** Download completes, flushes, fsyncs, and closes HTTP before parsing starts. */
  private fun downloadEpg(
    urlString: String,
    validators: EpgHttpValidators,
    allowNotModified: Boolean,
  ): DownloadedEpg {
    val sourceHash = sha256(urlString)
    validators.sourceHash = sourceHash
    val connection = URL(urlString).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 45_000
    connection.instanceFollowRedirects = true
    connection.setRequestProperty("User-Agent", "CharmIPTV/Experimental-v3")
    connection.setRequestProperty("Accept-Encoding", "gzip")

    val canUseValidators = allowNotModified && database.count() > 0L && database.getMeta(HTTP_SOURCE_HASH_KEY) == sourceHash
    if (canUseValidators) {
      database.getMeta(HTTP_ETAG_KEY)?.takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("If-None-Match", it) }
      database.getMeta(HTTP_LAST_MODIFIED_KEY)?.takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("If-Modified-Since", it) }
    }

    connection.connect()
    val status = connection.responseCode
    if (status == HttpURLConnection.HTTP_NOT_MODIFIED && canUseValidators) {
      connection.disconnect()
      throw EpgNotModifiedException()
    }
    if (status !in 200..299) {
      connection.disconnect()
      throw IllegalStateException("EPG HTTP $status")
    }

    validators.etag = connection.getHeaderField("ETag")?.trim().orEmpty()
    validators.lastModified = connection.getHeaderField("Last-Modified")?.trim().orEmpty()
    val declaredLength = connection.contentLengthLong
    if (declaredLength > MAX_COMPRESSED_EPG_BYTES) {
      connection.disconnect()
      throw IllegalStateException("EPG download exceeds the ${MAX_COMPRESSED_EPG_BYTES / MIB} MiB compressed safety limit")
    }
    database.assertRefreshStorageAvailable(declaredLength)

    val downloadDir = File(reactContext.cacheDir, DOWNLOAD_DIRECTORY)
    if (!downloadDir.exists() && !downloadDir.mkdirs()) {
      connection.disconnect()
      throw IllegalStateException("Could not create temporary EPG download directory")
    }
    cleanupAbandonedDownloads(downloadDir)
    val target = File.createTempFile("xmltv-", ".download", downloadDir)

    try {
      val connectionStream = object : FilterInputStream(connection.inputStream) {
        override fun close() {
          try { super.close() } finally { connection.disconnect() }
        }
      }
      val networkStream = BoundedInputStream(connectionStream, MAX_COMPRESSED_EPG_BYTES, "compressed EPG download")
      var copied = 0L
      FileOutputStream(target).use { fileOutput ->
        fileOutput.buffered(NETWORK_BUFFER_SIZE).use { output ->
          networkStream.use { input ->
            val buffer = ByteArray(NETWORK_BUFFER_SIZE)
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              output.write(buffer, 0, read)
              copied += read.toLong()
            }
            output.flush()
            fileOutput.fd.sync()
          }
        }
      }
      if (copied <= 0L) throw IllegalStateException("EPG download was empty")
      return DownloadedEpg(target, copied)
    } catch (t: Throwable) {
      target.delete()
      connection.disconnect()
      throw t
    }
  }

  private fun openDownloadedFile(file: File): InputStream {
    val buffered = BufferedInputStream(FileInputStream(file), FILE_BUFFER_SIZE)
    buffered.mark(2)
    val b1 = buffered.read()
    val b2 = buffered.read()
    buffered.reset()
    val decoded = if (b1 == 0x1f && b2 == 0x8b) GZIPInputStream(buffered, FILE_BUFFER_SIZE) else buffered
    return BoundedInputStream(decoded, MAX_DECOMPRESSED_EPG_BYTES, "decompressed EPG data")
  }

  private fun cleanupAbandonedDownloads(directory: File) {
    val cutoff = System.currentTimeMillis() - ABANDONED_DOWNLOAD_MAX_AGE_MS
    directory.listFiles()?.forEach { file ->
      if (file.isFile && file.name.startsWith("xmltv-") && file.lastModified() < cutoff) file.delete()
    }
  }

  private fun estimateProgramBytes(program: NativeEpgProgram): Long {
    fun stringBytes(value: String?) = if (value == null) 0L else 40L + value.length.toLong() * 2L
    return 56L + stringBytes(program.channelId) + stringBytes(program.title) +
      stringBytes(program.description) + stringBytes(program.category)
  }

  private fun heapUsed(runtime: Runtime) = runtime.totalMemory() - runtime.freeMemory()

  private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

  private fun resolveProgrammeStop(startMs: Long, parsedStopMs: Long): Long {
    if (startMs <= 0L) return 0L
    if (parsedStopMs > startMs && parsedStopMs - startMs <= MAX_PROGRAMME_DURATION_MS) return parsedStopMs
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
    private data class DownloadedEpg(val file: File, val bytes: Long)
    private class BoundedInputStream(
      input: InputStream,
      private val maxBytes: Long,
      private val label: String,
    ) : FilterInputStream(input) {
      private var bytesRead = 0L

      private fun account(count: Int): Int {
        if (count <= 0) return count
        bytesRead += count.toLong()
        if (bytesRead > maxBytes) throw IllegalStateException("$label exceeds the ${maxBytes / MIB} MiB safety limit")
        return count
      }

      override fun read(): Int {
        val value = super.read()
        if (value >= 0) account(1)
        return value
      }

      override fun read(buffer: ByteArray, offset: Int, length: Int): Int = account(super.read(buffer, offset, length))

      override fun skip(count: Long): Long {
        val skipped = super.skip(count)
        if (skipped > 0L) {
          bytesRead += skipped
          if (bytesRead > maxBytes) throw IllegalStateException("$label exceeds the ${maxBytes / MIB} MiB safety limit")
        }
        return skipped
      }
    }

    private class EpgNotModifiedException : Exception()
    private data class EpgHttpValidators(
      var sourceHash: String = "",
      var etag: String = "",
      var lastModified: String = "",
    )

    private const val MIB = 1024L * 1024L
    private const val HTTP_SOURCE_HASH_KEY = "epg_http_source_hash"
    private const val HTTP_ETAG_KEY = "epg_http_etag"
    private const val HTTP_LAST_MODIFIED_KEY = "epg_http_last_modified"
    private const val NETWORK_BUFFER_SIZE = 64 * 1024
    private const val FILE_BUFFER_SIZE = 64 * 1024
    private const val DOWNLOAD_DIRECTORY = "epg-downloads"
    private const val ABANDONED_DOWNLOAD_MAX_AGE_MS = 6L * 60L * 60L * 1000L
    private const val MAX_COMPRESSED_EPG_BYTES = 256L * MIB
    private const val MAX_DECOMPRESSED_EPG_BYTES = 1024L * MIB
    private const val MAX_PARSED_PROGRAM_BYTES = 96L * MIB
    private const val MAX_PROGRAMME_COUNT = 2_000_000L
    private const val PARSE_REFUSE_FRACTION = 0.72
    private const val GUIDE_HISTORY_MS = 3_153_600_000_000L
    private const val GUIDE_WINDOW_MS = 3_153_600_000_000L
    private const val MAX_QUERY_WINDOW_MS = 6_307_200_000_000L
    private const val ACTIVE_GUIDE_HISTORY_MS = 3_600_000L
    private const val ACTIVE_GUIDE_WINDOW_MS = 43_200_000L
    private const val HOUR_MS = 3_600_000L
    private const val CURRENT_CACHE_REFRESH_MS = 30_000L
    private const val DEFAULT_PROGRAMME_DURATION_MS = 30L * 60L * 1000L
    private const val MAX_PROGRAMME_DURATION_MS = 24L * 60L * 60L * 1000L
    private const val MIN_VACUUM_DELETED_ROWS = 5_000
  }
}
