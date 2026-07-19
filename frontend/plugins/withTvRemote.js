// Expo config plugin: native Android TV remote support WITHOUT the
// react-native-tvos fork (which the build pipeline doesn't support).
//
// It does what TVEventHandler does under the hood: overrides the Activity's
// dispatchKeyEvent to capture the D-pad / OK keys and forwards them to JS via
// RCTDeviceEventEmitter ("TvRemoteKey"). It also exposes a small native module
// (`TvRemote`) with tap(x, y) to inject a real touch (for pointer/mouse mode)
// and setPointerActive(bool) so the keys are consumed instead of moving the
// (unreliable, under Fabric) native focus.
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
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class TvRemoteModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "TvRemote"

  companion object {
    @JvmStatic
    var pointerActive: Boolean = false
  }

  @ReactMethod
  fun setPointerActive(active: Boolean) {
    pointerActive = active
  }

  @ReactMethod
  fun tap(x: Double, y: Double) {
    val activity = currentActivity ?: return
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
function withTvRemoteFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) return cfg;
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...pkg.split("."),
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "TvRemoteModule.kt"), moduleKt(pkg));
      fs.writeFileSync(path.join(dir, "TvRemotePackage.kt"), packageKt(pkg));
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
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

// 3) Override dispatchKeyEvent in MainActivity.kt to forward D-pad keys to JS.
function withTvRemoteKeyCapture(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("dispatchKeyEvent")) {
      cfg.modResults.contents = src;
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
    if (key != null) {
      try {
        val app = application as com.facebook.react.ReactApplication
        val rc = try { app.reactHost?.currentReactContext } catch (e: Throwable) { null }
          ?: try { app.reactNativeHost.reactInstanceManager.currentReactContext } catch (e: Throwable) { null }
        rc?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit("TvRemoteKey", key)
      } catch (e: Throwable) {}
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
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withTvRemote(config) {
  config = withTvRemoteFiles(config);
  config = withTvRemotePackageRegistered(config);
  config = withTvRemoteKeyCapture(config);
  return config;
};
