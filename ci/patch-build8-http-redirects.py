from pathlib import Path
import re


def replace_function(path: str, start_pattern: str, end_marker: str, replacement: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    match = re.search(start_pattern, text, flags=re.S)
    if not match:
        raise SystemExit(f"{label}: function start not found")
    start = match.start()
    end = text.find(end_marker, match.end())
    if end < 0:
        raise SystemExit(f"{label}: end marker not found")
    p.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


playlist_replacement = r'''  private fun openPlaylist(urlString: String): InputStream {
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

'''

replace_function(
    "frontend/android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt",
    r"  private fun openPlaylist\(urlString: String\): InputStream \{",
    "  /** Small direct attribute scanner",
    playlist_replacement,
    "NativePlaylistParser redirect repair",
)

playlist_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt")
playlist_text = playlist_path.read_text(encoding="utf-8")
if "private const val MAX_HTTP_REDIRECTS" not in playlist_text:
    anchor = "  private const val NETWORK_BUFFER_SIZE = 64 * 1024\n"
    if anchor not in playlist_text:
        raise SystemExit("NativePlaylistParser redirect constant anchor not found")
    playlist_text = playlist_text.replace(anchor, anchor + "  private const val MAX_HTTP_REDIRECTS = 6\n", 1)
    playlist_path.write_text(playlist_text, encoding="utf-8")


epg_replacement = r'''  private fun openPossiblyGzipped(
    urlString: String,
    validators: EpgHttpValidators,
    allowNotModified: Boolean,
  ): InputStream {
    val sourceHash = sha256(urlString)
    validators.sourceHash = sourceHash
    val canUseValidators =
      allowNotModified && database.count() > 0L && database.getMeta(HTTP_SOURCE_HASH_KEY) == sourceHash

    var currentUrl = URL(urlString)
    var redirects = 0
    while (true) {
      val scheme = currentUrl.protocol.lowercase(Locale.US)
      if (scheme != "http" && scheme != "https") {
        throw IllegalStateException("EPG redirect used unsupported scheme: $scheme")
      }

      val connection = currentUrl.openConnection() as HttpURLConnection
      connection.connectTimeout = 15_000
      connection.readTimeout = 45_000
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("User-Agent", "CharmIPTV/Experimental-v3")
      connection.setRequestProperty("Accept", "*/*")
      connection.setRequestProperty("Accept-Encoding", "gzip")
      if (canUseValidators) {
        database.getMeta(HTTP_ETAG_KEY)?.takeIf { it.isNotBlank() }?.let {
          connection.setRequestProperty("If-None-Match", it)
        }
        database.getMeta(HTTP_LAST_MODIFIED_KEY)?.takeIf { it.isNotBlank() }?.let {
          connection.setRequestProperty("If-Modified-Since", it)
        }
      }
      connection.connect()

      val status = connection.responseCode
      if (isHttpRedirect(status)) {
        val location = connection.getHeaderField("Location")?.trim().orEmpty()
        connection.disconnect()
        if (location.isEmpty()) throw IllegalStateException("EPG HTTP $status redirect missing Location")
        redirects += 1
        if (redirects > MAX_HTTP_REDIRECTS) {
          throw IllegalStateException("EPG redirect limit exceeded ($MAX_HTTP_REDIRECTS)")
        }
        currentUrl = URL(currentUrl, location)
        continue
      }

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
        throw IllegalStateException(
          "EPG download exceeds the ${MAX_COMPRESSED_EPG_BYTES / (1024L * 1024L)} MiB compressed safety limit"
        )
      }
      database.assertRefreshStorageAvailable(declaredLength)

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
        val networkStream = BoundedInputStream(
          connectionStream,
          MAX_COMPRESSED_EPG_BYTES,
          "compressed EPG download",
        ) { bytesRead ->
          val fraction = if (declaredLength > 0L) {
            bytesRead.toDouble() / declaredLength.toDouble()
          } else {
            1.0 - exp(-bytesRead.toDouble() / UNKNOWN_LENGTH_PROGRESS_SCALE_BYTES)
          }
          emitImportProgress("downloading", 0.2 + (0.28 * fraction.coerceIn(0.0, 1.0)))
        }
        val buffered = BufferedInputStream(networkStream, NETWORK_BUFFER_SIZE)
        buffered.mark(2)
        val b1 = buffered.read()
        val b2 = buffered.read()
        buffered.reset()

        val decoded = if (b1 == 0x1f && b2 == 0x8b) {
          GZIPInputStream(buffered, NETWORK_BUFFER_SIZE)
        } else {
          buffered
        }
        return BoundedInputStream(decoded, MAX_DECOMPRESSED_EPG_BYTES, "decompressed EPG data")
      } catch (t: Throwable) {
        connection.disconnect()
        throw t
      }
    }
  }

  private fun isHttpRedirect(status: Int): Boolean =
    status == HttpURLConnection.HTTP_MOVED_PERM ||
      status == HttpURLConnection.HTTP_MOVED_TEMP ||
      status == HttpURLConnection.HTTP_SEE_OTHER ||
      status == 307 ||
      status == 308

'''

replace_function(
    "frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt",
    r"  private fun openPossiblyGzipped\(\n    urlString: String,\n    validators: EpgHttpValidators,\n    allowNotModified: Boolean,\n  \): InputStream \{",
    "  private fun sha256(value: String): String {",
    epg_replacement,
    "EpgNativeModule redirect repair",
)

epg_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt")
epg_text = epg_path.read_text(encoding="utf-8")
if "private const val MAX_HTTP_REDIRECTS" not in epg_text:
    anchor = "    private const val NETWORK_BUFFER_SIZE = 64 * 1024\n"
    if anchor not in epg_text:
        raise SystemExit("EpgNativeModule redirect constant anchor not found")
    epg_text = epg_text.replace(anchor, anchor + "    private const val MAX_HTTP_REDIRECTS = 6\n", 1)
    epg_path.write_text(epg_text, encoding="utf-8")

print("Build 8 native IPTV redirect handling patched.")
