package com.charmiptv.app

import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.FilterInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.zip.GZIPInputStream

internal data class NativePlaylistChannel(
  val id: String,
  val rawTvgId: String,
  val name: String,
  val logo: String,
  val group: String,
  val url: String,
  val streamType: String,
)

internal data class NativePlaylistResult(
  val channels: List<NativePlaylistChannel>,
  val rejected: Int,
  val truncated: Boolean,
)

/**
 * Streaming M3U downloader/parser for TV devices. The playlist is never materialized
 * as one JS/Java String. We retain only the first MAX_CHANNELS lightweight raw rows
 * while scanning the complete input so duplicate tvg-id counts remain deterministic.
 */
internal object NativePlaylistParser {
  private data class RawEntry(
    val tvgId: String,
    val name: String,
    val group: String,
    val logo: String,
    val url: String,
  )

  private data class Pending(
    val tvgId: String,
    val name: String,
    val group: String,
    val logo: String,
  )

  fun fetch(urlString: String): NativePlaylistResult {
    val rawEntries = ArrayList<RawEntry>(4096)
    val tvgCounts = HashMap<String, Int>()
    var rejected = 0
    var truncated = false
    var pending: Pending? = null

    openPlaylist(urlString).use { stream ->
      BufferedReader(InputStreamReader(stream, Charsets.UTF_8), NETWORK_BUFFER_SIZE).use { reader ->
        var firstLine = true
        while (true) {
          val rawLine = reader.readLine() ?: break
          var line = rawLine.trim()
          if (firstLine) {
            firstLine = false
            if (line.startsWith('\uFEFF')) line = line.substring(1).trim()
          }
          if (line.startsWith("#EXTINF")) {
            if (pending != null) rejected += 1
            val tvgId = attribute(line, "tvg-id").trim()
            val tvgName = attribute(line, "tvg-name").trim()
            val comma = line.lastIndexOf(',')
            val name = if (comma >= 0 && comma + 1 < line.length) {
              line.substring(comma + 1).trim().ifEmpty { tvgName.ifEmpty { "Channel" } }
            } else {
              tvgName.ifEmpty { "Channel" }
            }
            pending = Pending(
              tvgId = tvgId,
              name = name,
              group = attribute(line, "group-title").trim(),
              logo = attribute(line, "tvg-logo").trim(),
            )
            continue
          }

          val meta = pending ?: continue
          if (line.isEmpty() || line.startsWith('#')) continue
          pending = null
          if (!isAllowedStreamUrl(line)) {
            rejected += 1
            continue
          }

          if (meta.tvgId.isNotEmpty()) {
            tvgCounts[meta.tvgId] = (tvgCounts[meta.tvgId] ?: 0) + 1
          }
          if (rawEntries.size < MAX_CHANNELS) {
            rawEntries.add(RawEntry(meta.tvgId, meta.name, meta.group, meta.logo, line))
          } else {
            truncated = true
          }
        }
      }
    }
    if (pending != null) rejected += 1

    val used = HashSet<String>(rawEntries.size * 2)
    val channels = ArrayList<NativePlaylistChannel>(rawEntries.size)
    for (entry in rawEntries) {
      val uniqueTvg = entry.tvgId.isNotEmpty() && (tvgCounts[entry.tvgId] ?: 0) == 1
      val fp = fingerprint(streamIdentityUrl(entry.url))
      val slug = slugify("${entry.name} ${entry.group}".trim()).ifEmpty {
        slugify(entry.name).ifEmpty { "ch-$fp" }
      }
      var preferred = when {
        uniqueTvg -> entry.tvgId
        entry.tvgId.isNotEmpty() -> "${entry.tvgId}~$fp"
        else -> slug
      }
      preferred = clipId(preferred.trim().ifEmpty { "ch-$fp" })

      val id = if (used.add(preferred)) {
        preferred
      } else {
        allocateFallbackId(entry, used)
      }
      channels.add(
        NativePlaylistChannel(
          id = id,
          rawTvgId = entry.tvgId,
          name = entry.name,
          logo = entry.logo,
          group = entry.group,
          url = entry.url,
          streamType = streamType(entry.url),
        )
      )
    }

    return NativePlaylistResult(channels, rejected, truncated)
  }

  private fun openPlaylist(urlString: String): InputStream {
    var currentUrl = URL(urlString)
    var redirects = 0

    while (true) {
      val scheme = currentUrl.protocol.lowercase(Locale.US)
      if (scheme != "http" && scheme != "https") {
        throw IllegalStateException("M3U redirect used unsupported scheme: $scheme")
      }

      val connection = currentUrl.openConnection() as HttpURLConnection
      connection.connectTimeout = 15_000
      connection.readTimeout = 45_000
      // Android/Java automatic redirect handling is inconsistent for some IPTV
      // endpoints (especially cross-protocol/port and relative Location values).
      // Follow redirects explicitly so a valid Xtream get.php 302 does not fail.
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("User-Agent", "CharmIPTV/Experimental-v3")
      connection.setRequestProperty("Accept", "*/*")
      connection.setRequestProperty("Accept-Encoding", "gzip")
      connection.connect()

      val status = connection.responseCode
      if (isRedirectStatus(status)) {
        val location = connection.getHeaderField("Location")?.trim().orEmpty()
        connection.disconnect()
        if (location.isEmpty()) throw IllegalStateException("M3U HTTP $status redirect missing Location")
        redirects += 1
        if (redirects > MAX_HTTP_REDIRECTS) {
          throw IllegalStateException("M3U redirect limit exceeded ($MAX_HTTP_REDIRECTS)")
        }
        currentUrl = URL(currentUrl, location)
        continue
      }

      if (status !in 200..299) {
        connection.disconnect()
        throw IllegalStateException("M3U HTTP $status")
      }
      val declared = connection.contentLengthLong
      if (declared > MAX_PLAYLIST_BYTES) {
        connection.disconnect()
        throw IllegalStateException("Playlist exceeds size limit ($MAX_PLAYLIST_BYTES bytes)")
      }

      try {
        val connectionStream = object : FilterInputStream(connection.inputStream) {
          override fun close() {
            try {
              super.close()
            } finally {
              connection.disconnect()
            }
          }
        }
        val compressed = BoundedInputStream(connectionStream, MAX_PLAYLIST_BYTES)
        val buffered = BufferedInputStream(compressed, NETWORK_BUFFER_SIZE)
        buffered.mark(2)
        val b1 = buffered.read()
        val b2 = buffered.read()
        buffered.reset()
        val decoded = if (b1 == 0x1f && b2 == 0x8b) GZIPInputStream(buffered, NETWORK_BUFFER_SIZE) else buffered
        return BoundedInputStream(decoded, MAX_PLAYLIST_BYTES)
      } catch (t: Throwable) {
        connection.disconnect()
        throw t
      }
    }
  }

  private fun isRedirectStatus(status: Int): Boolean =
    status == HttpURLConnection.HTTP_MOVED_PERM ||
      status == HttpURLConnection.HTTP_MOVED_TEMP ||
      status == HttpURLConnection.HTTP_SEE_OTHER ||
      status == 307 ||
      status == 308

  /** Small direct attribute scanner; avoids regex allocation in the #EXTINF hot loop. */
  private fun attribute(line: String, key: String): String {
    var from = 0
    while (true) {
      val index = line.indexOf(key, from, ignoreCase = true)
      if (index < 0) return ""
      val beforeOk = index == 0 || line[index - 1].isWhitespace()
      var cursor = index + key.length
      while (cursor < line.length && line[cursor].isWhitespace()) cursor += 1
      if (beforeOk && cursor < line.length && line[cursor] == '=') {
        cursor += 1
        while (cursor < line.length && line[cursor].isWhitespace()) cursor += 1
        if (cursor >= line.length) return ""
        val quote = line[cursor]
        if (quote == '"' || quote == '\'') {
          val end = line.indexOf(quote, cursor + 1)
          return if (end > cursor) line.substring(cursor + 1, end) else ""
        }
        var end = cursor
        while (end < line.length && !line[end].isWhitespace()) end += 1
        return line.substring(cursor, end)
      }
      from = index + key.length
    }
  }

  private fun isAllowedStreamUrl(raw: String): Boolean {
    val identity = streamIdentityUrl(raw)
    val colon = identity.indexOf(':')
    if (colon <= 0) return false
    return when (identity.substring(0, colon).lowercase(Locale.US)) {
      "http", "https", "rtsp", "rtsps", "rtmp", "rtmps" -> true
      else -> false
    }
  }

  private fun streamIdentityUrl(url: String): String =
    url.substringBefore('|').trim().lowercase(Locale.US)

  private fun streamType(url: String): String {
    val clean = url.lowercase(Locale.US).substringBefore('?').substringBefore('|')
    return when {
      clean.endsWith(".m3u8") -> "hls"
      clean.endsWith(".ts") -> "ts"
      else -> "unknown"
    }
  }

  private fun fingerprint(value: String): String {
    var hash = 5381
    for (ch in value) hash = ((hash shl 5) + hash) xor ch.code
    return hash.toUInt().toString(16).padStart(8, '0')
  }

  private fun slugify(value: String): String {
    val out = StringBuilder(value.length)
    var dashPending = false
    for (ch in value) {
      val asciiAlphaNum = ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9'
      if (asciiAlphaNum) {
        if (dashPending && out.isNotEmpty()) out.append('-')
        out.append(ch.lowercaseChar())
        dashPending = false
      } else if (out.isNotEmpty()) {
        dashPending = true
      }
    }
    return out.toString().trim('-')
  }

  private fun clipId(value: String): String = if (value.length <= MAX_CHANNEL_ID_LEN) value else value.substring(0, MAX_CHANNEL_ID_LEN)

  private fun allocateFallbackId(entry: RawEntry, used: MutableSet<String>): String {
    val fp = fingerprint(streamIdentityUrl(entry.url))
    val slug = slugify("${entry.name} ${entry.group}".trim()).ifEmpty {
      slugify(entry.name).ifEmpty { "ch-$fp" }
    }
    val preferred = clipId(slug.ifEmpty { "ch-$fp" })
    if (used.add(preferred)) return preferred
    val withFp = clipId("$preferred~$fp")
    if (used.add(withFp)) return withFp
    var n = 2
    while (true) {
      val candidate = clipId("$withFp~$n")
      if (used.add(candidate)) return candidate
      n += 1
    }
  }

  private class BoundedInputStream(input: InputStream, private val maxBytes: Long) : FilterInputStream(input) {
    private var bytesRead = 0L

    private fun account(count: Int): Int {
      if (count <= 0) return count
      bytesRead += count.toLong()
      if (bytesRead > maxBytes) throw IllegalStateException("Playlist exceeds size limit ($maxBytes bytes)")
      return count
    }

    override fun read(): Int {
      val value = super.read()
      if (value >= 0) account(1)
      return value
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = account(super.read(buffer, offset, length))
  }

  private const val NETWORK_BUFFER_SIZE = 64 * 1024
  private const val MAX_HTTP_REDIRECTS = 6
  private const val MAX_PLAYLIST_BYTES = 32L * 1024L * 1024L
  private const val MAX_CHANNELS = 25_000
  private const val MAX_CHANNEL_ID_LEN = 160
}
