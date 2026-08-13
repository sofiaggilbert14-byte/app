// Expo config plugin: native Android TV remote support WITHOUT the
// react-native-tvos fork (which the build pipeline doesn't support).
//
// It overrides the Activity's dispatchKeyEvent to capture the D-pad / OK keys
// and forwards them to JS via RCTDeviceEventEmitter ("TvRemoteKey"). It also
// exposes native helpers for pointer mode and deterministic guide focus.
const {
  withMainActivity,
  withMainApplication,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function moduleKt(pkg) {
  return `package ${pkg}

import android.os.SystemClock
import android.view.MotionEvent
import android.media.MediaCodecList
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class TvRemoteModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "TvRemote"

  companion object {
    // Use @JvmField (a plain static field, no accessors) so Kotlin does NOT
    // generate a static setPointerActive(...) setter that would clash at the
    // JVM level with the @ReactMethod fun setPointerActive(...) below.
    @JvmField
    var pointerActive: Boolean = false
    @JvmField
    var guideNavigationActive: Boolean = false
    @JvmField
    var guideRepeatIntervalMs: Long = 72L
    private const val MAX_SANE_CODEC_DIMENSION = 16_384
  }

  @ReactMethod
  fun setPointerActive(active: Boolean) {
    pointerActive = active
  }

  @ReactMethod
  fun setGuideNavigationActive(active: Boolean) {
    guideNavigationActive = active
  }

  @ReactMethod
  fun setGuideRepeatInterval(milliseconds: Double) {
    guideRepeatIntervalMs = milliseconds.toLong().coerceIn(60L, 120L)
  }

  @ReactMethod
  fun tap(x: Double, y: Double) {
    val activity = ctx.getCurrentActivity() ?: return
    activity.runOnUiThread {
      try {
        val root = activity.window.decorView
        val t = SystemClock.uptimeMillis()
        val down = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x.toFloat(), y.toFloat(), 0)
        val up = MotionEvent.obtain(t, t + 40, MotionEvent.ACTION_UP, x.toFloat(), y.toFloat(), 0)
        root.dispatchTouchEvent(down)
        root.dispatchTouchEvent(up)
        down.recycle()
        up.recycle()
      } catch (e: Throwable) {}
    }
  }

  /** One-shot codec diagnostics; never run during channel changes. */
  @ReactMethod
  fun getCodecCapabilities(promise: Promise) {
    try {
      val mimeTypes = LinkedHashSet<String>()
      var maxWidth = 0
      var maxHeight = 0
      for (info in MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos) {
        if (info.isEncoder) continue
        for (type in info.supportedTypes) {
          val mime = type.lowercase()
          mimeTypes.add(mime)
          if (mime.startsWith("video/")) {
            try {
              val video = info.getCapabilitiesForType(type).videoCapabilities
              val advertisedWidth = video.supportedWidths.upper
              val advertisedHeight = video.supportedHeights.upper
              if (advertisedWidth in 1..MAX_SANE_CODEC_DIMENSION) {
                maxWidth = maxOf(maxWidth, advertisedWidth)
              }
              if (advertisedHeight in 1..MAX_SANE_CODEC_DIMENSION) {
                maxHeight = maxOf(maxHeight, advertisedHeight)
              }
            } catch (_: Throwable) {}
          }
        }
      }
      promise.resolve(Arguments.createMap().apply {
        putBoolean("h264", mimeTypes.contains("video/avc"))
        putBoolean("hevc", mimeTypes.contains("video/hevc"))
        putBoolean("vp9", mimeTypes.contains("video/x-vnd.on2.vp9"))
        putBoolean("av1", mimeTypes.contains("video/av01"))
        putBoolean("aac", mimeTypes.contains("audio/mp4a-latm"))
        putBoolean("ac3", mimeTypes.contains("audio/ac3"))
        putBoolean("eac3", mimeTypes.contains("audio/eac3") || mimeTypes.contains("audio/eac3-joc"))
        putInt("maxWidth", maxWidth)
        putInt("maxHeight", maxHeight)
      })
    } catch (t: Throwable) {
      promise.reject("CODEC_REPORT_FAILED", t.message ?: "Codec report unavailable", t)
    }
  }

  // Required so JS NativeEventEmitter doesn't warn.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

}
`;
}

function packageKt(pkg) {
  return `package ${pkg}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class TvRemotePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(TvRemoteModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;
}

// 1) Write the Kotlin module + package files into the app source dir.
// ApplicationId may be a side-by-side suffix (e.g. *.purple.next) while Kotlin
// sources stay under the Android namespace. Always write native modules there.
const KOTLIN_NAMESPACE = "com.charmiptv.app";

function withTvRemoteFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...KOTLIN_NAMESPACE.split("."),
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "TvRemoteModule.kt"), moduleKt(KOTLIN_NAMESPACE));
      fs.writeFileSync(path.join(dir, "TvRemotePackage.kt"), packageKt(KOTLIN_NAMESPACE));
      return cfg;
    },
  ]);
}

// 2) Register the package in MainApplication.kt.
function withTvRemotePackageRegistered(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("TvRemotePackage()")) {
      // Insert right after the auto-linked package list is created.
      const anchor = "val packages = PackageList(this).packages";
      if (src.includes(anchor)) {
        src = src.replace(
          anchor,
          `${anchor}\n            packages.add(TvRemotePackage())`,
        );
      } else {
        // Expo SDK 54 uses an expression body with `.apply {}` rather than a
        // mutable `val packages`. Register inside that block.
        const applyAnchor = "PackageList(this).packages.apply {";
        if (src.includes(applyAnchor)) {
          src = src.replace(
            applyAnchor,
            `${applyAnchor}\n              add(TvRemotePackage())`,
          );
        } else {
          throw new Error("Unable to register TvRemotePackage in MainApplication.kt");
        }
      }
    }
    if (!src.includes("android.content.ComponentCallbacks2")) {
      src = src.replace("import android.app.Application", "import android.app.Application\nimport android.content.ComponentCallbacks2");
    }
    if (!src.includes("DeviceEventManagerModule")) {
      src = src.replace(
        "import com.facebook.react.defaults.DefaultReactNativeHost",
        "import com.facebook.react.defaults.DefaultReactNativeHost\nimport com.facebook.react.modules.core.DeviceEventManagerModule",
      );
    }
    if (!src.includes("override fun onTrimMemory")) {
      const method = `

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    val pressure = when {
      level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
        level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> "critical"
      level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> "moderate"
      else -> null
    } ?: return
    try {
      reactNativeHost.reactInstanceManager.currentReactContext
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("CharmMemoryPressure", pressure)
    } catch (_: Throwable) {}
  }
`;
      const closing = src.lastIndexOf("}");
      if (closing > 0) src = src.slice(0, closing) + method + src.slice(closing);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function hardenMainActivity(src) {
  src = src
    .replace(/private val minDpadRepeatMs = \d+L/, "private val minDpadRepeatMs = 48L")
    .replace(/private const val MIN_DPAD_REPEAT_MS = \d+L/, "private const val MIN_DPAD_REPEAT_MS = 48L")
    .replace(/\n\s*private val guideFocusAckTimeoutMs = \d+L/, "")
    .replace(/\n\s*private const val GUIDE_FOCUS_ACK_TIMEOUT_MS = \d+L/, "")
    .replace(
      /      val pageKey = when \(event\.keyCode\) \{[\s\S]*?\n      \}\n      if \(pageKey != null\)/,
      `      val pageKey = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_CHANNEL_UP,
        android.view.KeyEvent.KEYCODE_PAGE_UP,
        android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "UP"
        android.view.KeyEvent.KEYCODE_CHANNEL_DOWN,
        android.view.KeyEvent.KEYCODE_PAGE_DOWN,
        android.view.KeyEvent.KEYCODE_MEDIA_NEXT -> "DOWN"
        else -> when (event.scanCode) {
          0x192, 0x1b8 -> "UP"
          0x193, 0x1b9 -> "DOWN"
          else -> null
        }
      }
      if (pageKey != null)`,
    );
  const classMatch = src.match(/class\s+MainActivity[^{]*\{/);
  if (classMatch && !src.includes("lastAcceptedDirectionalRepeatAt")) {
    const idx = src.indexOf(classMatch[0]) + classMatch[0].length;
    const fields = `

  private var lastAcceptedDirectionalRepeatAt = 0L
  private var lastAcceptedDirectionalKeyCode = -1
  private val minDpadRepeatMs = 48L
`;
    src = src.slice(0, idx) + fields + src.slice(idx);
    src = src.replace(
      "  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {\n",
      `  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val directional =
      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_LEFT ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_RIGHT
    if (event.action == android.view.KeyEvent.ACTION_DOWN && directional) {
      val guideActive =
        TvRemoteModule.guideNavigationActive &&
          !TvRemoteModule.pointerActive
      if (event.repeatCount == 0) {
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      } else {
        val elapsed = event.eventTime - lastAcceptedDirectionalRepeatAt
        val sameDirection = event.keyCode == lastAcceptedDirectionalKeyCode
        if (sameDirection) {
          val repeatFloor = if (guideActive) TvRemoteModule.guideRepeatIntervalMs else minDpadRepeatMs
          if (elapsed < repeatFloor) return true
        }
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      }
    } else if (event.action == android.view.KeyEvent.ACTION_UP && directional) {
      lastAcceptedDirectionalKeyCode = -1
      lastAcceptedDirectionalRepeatAt = 0L
    }
`,
    );
  }

  if (src.includes("dispatchKeyEvent") && !src.includes('"TvGuidePageKey"')) {
    const pageKeys = `    // Channel/Page keys page the Guide without overloading ordinary D-pad taps.
    if (
      event.action == android.view.KeyEvent.ACTION_DOWN &&
        event.repeatCount == 0 &&
        TvRemoteModule.guideNavigationActive &&
        !TvRemoteModule.pointerActive
    ) {
      val pageKey = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_CHANNEL_UP,
        android.view.KeyEvent.KEYCODE_PAGE_UP,
        android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "UP"
        android.view.KeyEvent.KEYCODE_CHANNEL_DOWN,
        android.view.KeyEvent.KEYCODE_PAGE_DOWN,
        android.view.KeyEvent.KEYCODE_MEDIA_NEXT -> "DOWN"
        else -> when (event.scanCode) {
          0x192, 0x1b8 -> "UP"
          0x193, 0x1b9 -> "DOWN"
          else -> null
        }
      }
      if (pageKey != null) {
        try {
          val app = application as com.facebook.react.ReactApplication
          val rc = try { app.reactHost?.currentReactContext } catch (e: Throwable) { null }
            ?: try { app.reactNativeHost.reactInstanceManager.currentReactContext } catch (e: Throwable) { null }
          rc?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("TvGuidePageKey", pageKey)
        } catch (_: Throwable) {}
        return true
      }
    }

`;
    src = src.replace(
      "  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {\n",
      `  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {\n${pageKeys}`,
    );
  }

  if (!src.includes("FLAG_KEEP_SCREEN_ON")) {
    src = src.replace(
      "  override fun onCreate(savedInstanceState: Bundle?) {",
      `  override fun onCreate(savedInstanceState: Bundle?) {
    window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)`,
    );
  }

  if (!src.includes("Static remote flags must never survive")) {
    const lifecycle = `
  override fun onDestroy() {
    // Static remote flags must never survive an Activity/bridge teardown.
    TvRemoteModule.pointerActive = false
    TvRemoteModule.guideNavigationActive = false
    super.onDestroy()
  }

`;
    src = src.replace("  override fun getMainComponentName()", lifecycle + "  override fun getMainComponentName()");
  }
  return src;
}

// 3) Override dispatchKeyEvent in MainActivity.kt to forward D-pad keys to JS.
function withTvRemoteKeyCapture(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Upgrade an Activity produced by an earlier version of this plugin.
    // Never consume guide Up/Down — that freezes Android focus surfing in the grid.
    if (src.includes("dispatchKeyEvent")) {
      src = src.replace(
        /\n\s*if \(TvRemoteModule\.guideNavigationActive && \(key == "UP" \|\| key == "DOWN"\)\) return true/g,
        "",
      );
      cfg.modResults.contents = hardenMainActivity(src);
      return cfg;
    }

    const method = `
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val key: String? = if (event.action == android.view.KeyEvent.ACTION_DOWN) {
      when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_UP -> "UP"
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"
        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> "LEFT"
        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> "RIGHT"
        android.view.KeyEvent.KEYCODE_DPAD_CENTER,
        android.view.KeyEvent.KEYCODE_ENTER,
        android.view.KeyEvent.KEYCODE_NUMPAD_ENTER,
        android.view.KeyEvent.KEYCODE_BUTTON_A -> "SELECT"
        else -> null
      }
    } else null
    if (key != null && (!TvRemoteModule.guideNavigationActive || TvRemoteModule.pointerActive)) {
      try {
        val app = application as com.facebook.react.ReactApplication
        val rc = try { app.reactHost?.currentReactContext } catch (e: Throwable) { null }
          ?: try { app.reactNativeHost.reactInstanceManager.currentReactContext } catch (e: Throwable) { null }
        rc?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit("TvRemoteKey", key)
      } catch (e: Throwable) {}
      // Pointer mode owns D-pad. Guide Up/Down must reach Android's focus engine.
      if (TvRemoteModule.pointerActive) return true
    }
    return super.dispatchKeyEvent(event)
  }
`;
    // Insert the method right after the class opening brace.
    const classMatch = src.match(/class\s+MainActivity[^{]*\{/);
    if (classMatch) {
      const idx = src.indexOf(classMatch[0]) + classMatch[0].length;
      src = src.slice(0, idx) + "\n" + method + src.slice(idx);
    }
    cfg.modResults.contents = hardenMainActivity(src);
    return cfg;
  });
}

module.exports = function withTvRemote(config) {
  config = withTvRemoteFiles(config);
  config = withTvRemotePackageRegistered(config);
  config = withTvRemoteKeyCapture(config);
  return config;
};
