package com.charmiptv.app

import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.FilterInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import okhttp3.Request
import okhttp3.Response

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
 *
 * Transport intentionally uses React Native's shared OkHttp stack. This mirrors the
 * provider-stream architecture documented by the TiViMate clean-room analysis and
 * keeps compatibility with IPTV servers that behave poorly with HttpURLConnection.
 * A whole-call deadline prevents a trickling/broken response from pinning startup at
 * the channel-import boundary indefinitely; callers preserve the last-good catalog.
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
    val cleanUrl = urlString.trim()
    if (!isHttpUrl(cleanUrl)) {
      throw IllegalStateException("M3U URL must use http or https")
    }

    // Preserve the provider protocol exactly. Many Xtream-style providers use
    // cleartext HTTP for both playlist and XMLTV endpoints; sideload builds
    // explicitly permit that transport. Stream URLs inside the M3U are also
    // retained verbatim.
    val client = OkHttpClientProvider.getOkHttpClient().newBuilder()
      .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .followRedirects(true)
      .followSslRedirects(true)
      .build()
    val request = Request.Builder()
      .url(cleanUrl)
      .header("User-Agent", "CharmIPTV/Experimental-v3")
      .header("Accept", "*/*")
      .build()
    val response = client.newCall(request).execute()
    if (!response.isSuccessful) {
      val code = response.code
      response.close()
      throw IllegalStateException("M3U HTTP $code")
    }
    val body = response.body
    if (body == null) {
      response.close()
      throw IllegalStateException("M3U response had no body")
    }
    val declared = body.contentLength()
    if (declared > MAX_PLAYLIST_BYTES) {
      response.close()
      throw IllegalStateException("Playlist exceeds size limit ($MAX_PLAYLIST_BYTES bytes)")
    }

    try {
      val responseStream = ResponseClosingInputStream(body.byteStream(), response)
      val bounded = BoundedInputStream(responseStream, MAX_PLAYLIST_BYTES)
      val buffered = BufferedInputStream(bounded, NETWORK_BUFFER_SIZE)
      buffered.mark(2)
      val b1 = buffered.read()
      val b2 = buffered.read()
      buffered.reset()
      val decoded = if (b1 == 0x1f && b2 == 0x8b) {
        GZIPInputStream(buffered, NETWORK_BUFFER_SIZE)
      } else {
        buffered
      }
      return BoundedInputStream(decoded, MAX_PLAYLIST_BYTES)
    } catch (t: Throwable) {
      response.close()
      throw t
    }
  }

  private fun isHttpUrl(raw: String): Boolean {
    val schemeEnd = raw.indexOf(':')
    if (schemeEnd <= 0) return false
    return when (raw.substring(0, schemeEnd).lowercase(Locale.US)) {
      "http", "https" -> true
      else -> false
    }
  }

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

  private class ResponseClosingInputStream(
    input: InputStream,
    private val response: Response,
  ) : FilterInputStream(input) {
    override fun close() {
      try {
        super.close()
      } finally {
        response.close()
      }
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
  private const val CONNECT_TIMEOUT_SECONDS = 15L
  private const val READ_TIMEOUT_SECONDS = 45L
  private const val CALL_TIMEOUT_SECONDS = 90L
  private const val MAX_PLAYLIST_BYTES = 32L * 1024L * 1024L
  private const val MAX_CHANNELS = 25_000
  private const val MAX_CHANNEL_ID_LEN = 160
}
