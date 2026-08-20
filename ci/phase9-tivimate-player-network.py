from pathlib import Path

patch = Path('frontend/patches/expo-video+3.0.16.patch')
text = patch.read_text(encoding='utf-8')
marker = 'CharmIPTV shared live-TV OkHttp pool'
if marker not in text:
    text += r'''
diff --git a/node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt b/node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt
--- a/node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt
+++ b/node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt
@@ -13,7 +13,20 @@ import androidx.media3.exoplayer.source.MediaSource
 import expo.modules.video.records.VideoSource
+import okhttp3.ConnectionPool
 import okhttp3.OkHttpClient
+import java.util.concurrent.TimeUnit
+
+// CharmIPTV shared live-TV OkHttp pool. Reusing one client keeps TCP/TLS
+// connections warm across channel zaps instead of constructing a fresh pool
+// for every VideoSource. Short socket timeouts let the buffering watchdog
+// recover a hung provider connection instead of waiting tens of seconds.
+private val charmSharedVideoHttpClient: OkHttpClient by lazy {
+  OkHttpClient.Builder()
+    .connectionPool(ConnectionPool(15, 5, TimeUnit.MINUTES))
+    .connectTimeout(5, TimeUnit.SECONDS)
+    .readTimeout(5, TimeUnit.SECONDS)
+    .followRedirects(true)
+    .followSslRedirects(true)
+    .retryOnConnectionFailure(true)
+    .build()
+}
 
 @OptIn(UnstableApi::class)
 fun buildBaseDataSourceFactory(context: Context, videoSource: VideoSource): DataSource.Factory {
@@ -26,8 +39,6 @@ fun buildBaseDataSourceFactory(context: Context, videoSource: VideoSource): Data
 
 @OptIn(UnstableApi::class)
 fun buildOkHttpDataSourceFactory(context: Context, videoSource: VideoSource): OkHttpDataSource.Factory {
-  val client = OkHttpClient.Builder().build()
-
   // If the application name has ANY non-ASCII characters, we need to strip them out. This is because using non-ASCII characters
   // in the User-Agent header can cause issues with getting the media to play.
   val applicationName = getApplicationName(context).filter { it.code in 0..127 }
@@ -35,7 +46,7 @@ fun buildOkHttpDataSourceFactory(context: Context, videoSource: VideoSource): Ok
 
   val defaultUserAgent = Util.getUserAgent(context, applicationName)
 
-  return OkHttpDataSource.Factory(client).apply {
+  return OkHttpDataSource.Factory(charmSharedVideoHttpClient).apply {
     val headers = videoSource.headers
     headers?.takeIf { it.isNotEmpty() }?.let {
       setDefaultRequestProperties(it)
diff --git a/node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt b/node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt
--- a/node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt
+++ b/node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt
@@ -42,7 +42,11 @@ class VideoPlayerLoadControl : DefaultLoadControl() {
       (bufferOptions.minBufferForPlayback * 1000).toLong()
     }
     bufferForPlaybackMs = safeBufferForPlayback
-    bufferForPlaybackAfterRebufferMs = safeBufferForPlayback
+    // Live IPTV should start quickly, but after a network dip require at least
+    // one second before resuming so we do not bounce straight back into BUFFERING.
+    // This mirrors the TiviMate-style 500ms start / 1000ms rebuffer split while
+    // preserving larger user-selected startup thresholds.
+    bufferForPlaybackAfterRebufferMs = maxOf(1_000L, safeBufferForPlayback)
 
     updateAllocator()
   }
'''
    patch.write_text(text, encoding='utf-8')

stream = Path('frontend/src/components/StreamPlayer.tsx')
text = stream.read_text(encoding='utf-8')
text = text.replace('const BUFFERING_RESYNC_MS = 7000;', 'const BUFFERING_RESYNC_MS = 5000;', 1)
# Keep the longer terminal failure window: two silent resync attempts get a fair
# chance before escalating to parent retry/engine fallback.
old_preview = '''      player.bufferOptions = mode === "preview"\n        ? {\n            preferredForwardBufferDuration: 1.2,\n            maxBufferBytes: Math.min(12 * 1024 * 1024, coordinatedCacheBudget),\n          }\n        : { ...full, maxBufferBytes: Math.min(full.maxBufferBytes, coordinatedCacheBudget) };'''
new_preview = '''      const minBufferForPlayback = profile === "low_latency" ? 0.5 : profile === "stable" ? 1.0 : 0.75;\n      player.bufferOptions = mode === "preview"\n        ? {\n            preferredForwardBufferDuration: 1.2,\n            minBufferForPlayback: 0.5,\n            maxBufferBytes: Math.min(12 * 1024 * 1024, coordinatedCacheBudget),\n          }\n        : {\n            ...full,\n            minBufferForPlayback,\n            maxBufferBytes: Math.min(full.maxBufferBytes, coordinatedCacheBudget),\n          };'''
if old_preview not in text:
    raise SystemExit('StreamPlayer bufferOptions block not found')
text = text.replace(old_preview, new_preview, 1)
stream.write_text(text, encoding='utf-8')
