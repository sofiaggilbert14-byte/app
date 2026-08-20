from pathlib import Path

parser = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt")
text = parser.read_text(encoding="utf-8")
old = '''  private fun openPlaylist(urlString: String): InputStream {
    val cleanUrl = urlString.trim()
    if (!isHttpUrl(cleanUrl)) {
      throw IllegalStateException("M3U URL must use http or https")
    }
'''
new = '''  private fun openPlaylist(urlString: String): InputStream {
    val requestedUrl = urlString.trim()
    if (!isHttpUrl(requestedUrl)) {
      throw IllegalStateException("M3U URL must use http or https")
    }
    // Preserve the transport behavior of the last known-good Charm builds:
    // legacy IPTV http:// playlist endpoints are attempted over HTTPS first.
    // This keeps cold start on the same provider path that previously loaded
    // successfully while the sideload manifest still permits cleartext stream
    // playback URLs returned inside the playlist itself.
    val cleanUrl = if (requestedUrl.startsWith("http://", ignoreCase = true)) {
      "https://${requestedUrl.substring(7)}"
    } else {
      requestedUrl
    }
'''
if old not in text:
    raise SystemExit("NativePlaylistParser openPlaylist anchor not found")
text = text.replace(old, new, 1)
parser.write_text(text, encoding="utf-8")

# Lock the 6% regression: the native provider request must retain the
# HTTPS-upgrade behavior of the last working loader. Stream URLs inside the
# M3U remain untouched and can still be cleartext in sideload builds.
test = Path("frontend/tests/nativePlatformHardening.test.mjs")
t = test.read_text(encoding="utf-8")
needle = 'NativePlaylistParser'
if needle not in t:
    raise SystemExit("nativePlatformHardening test no longer covers NativePlaylistParser")
marker = 'assert.match(nativePlaylistParser, /OkHttpClientProvider/);'
if marker in t and 'requestedUrl.startsWith("http://"' not in t:
    t = t.replace(marker, marker + '\nassert.match(nativePlaylistParser, /requestedUrl\\.startsWith\\("http:\\/\\/"/);\nassert.match(nativePlaylistParser, /"https:\\/\\/\\$\\{requestedUrl\\.substring\\(7\\)\\}"/);', 1)
    test.write_text(t, encoding="utf-8")

print("Restored known-good HTTPS-first playlist acquisition at the 6% boundary.")
