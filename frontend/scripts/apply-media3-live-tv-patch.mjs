import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function patchFile(relativePath, transform) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`Missing Media3 patch target: ${relativePath}`);
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`[media3-live-tv] already applied or no change: ${relativePath}`);
    return;
  }
  fs.writeFileSync(file, after);
  console.log(`[media3-live-tv] patched ${relativePath}`);
}

patchFile(
  "node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt",
  (source) => {
    let next = source;
    if (!next.includes("import okhttp3.ConnectionPool")) {
      next = next.replace(
        "import okhttp3.OkHttpClient",
        "import okhttp3.ConnectionPool\nimport okhttp3.OkHttpClient\nimport java.util.concurrent.TimeUnit",
      );
    }
    if (!next.includes("sharedVideoOkHttpClient")) {
      next = next.replace(
        "@OptIn(UnstableApi::class)\nfun buildBaseDataSourceFactory",
        `private val sharedVideoOkHttpClient: OkHttpClient by lazy {\n  OkHttpClient.Builder()\n    .connectTimeout(5, TimeUnit.SECONDS)\n    .readTimeout(10, TimeUnit.SECONDS)\n    .connectionPool(ConnectionPool(5, 5, TimeUnit.MINUTES))\n    .retryOnConnectionFailure(true)\n    .build()\n}\n\n@OptIn(UnstableApi::class)\nfun buildBaseDataSourceFactory`,
      );
    }
    next = next.replace(
      "val client = OkHttpClient.Builder().build()",
      "val client = sharedVideoOkHttpClient",
    );
    return next;
  },
);

patchFile(
  "node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt",
  (source) => source.replace(
    "bufferForPlaybackMs = safeBufferForPlayback\n    bufferForPlaybackAfterRebufferMs = safeBufferForPlayback",
    `bufferForPlaybackMs = safeBufferForPlayback\n    // Live TV should resume quickly but not oscillate on a half-empty socket.\n    // Keep normal startup at the requested value (Charm uses ~500ms) while\n    // requiring up to 1000ms after a real rebuffer, bounded by targetBufferMs.\n    bufferForPlaybackAfterRebufferMs = maxOf(\n      safeBufferForPlayback,\n      minOf(1000L, targetBufferMs)\n    )`,
  ),
);
