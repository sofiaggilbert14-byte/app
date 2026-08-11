package com.charmiptv.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {

  private var lastAcceptedDirectionalRepeatAt = 0L
  private var lastAcceptedDirectionalKeyCode = -1
  private var activeDirectionalKeyCode = -1
  private var activeDirectionalDownAt = 0L
  private var activeDirectionalRepeated = false

  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val directional =
      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_LEFT ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_RIGHT

    // Keep the first press instant and preserve normal Android TV remote repeat
    // cadence. Cap pathological sub-frame repeat bursts before they can queue
    // more native focus searches than React/FlashList can commit. 32 ms still
    // permits roughly 31 row moves per second on capable Android TV hardware.
    if (event.action == android.view.KeyEvent.ACTION_DOWN && directional) {
      if (event.repeatCount == 0) {
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
        activeDirectionalKeyCode = event.keyCode
        activeDirectionalDownAt = event.eventTime
        activeDirectionalRepeated = false
      } else {
        activeDirectionalRepeated = true
        val elapsed = event.eventTime - lastAcceptedDirectionalRepeatAt
        if (event.keyCode == lastAcceptedDirectionalKeyCode && elapsed < MIN_DPAD_REPEAT_MS) {
          return true
        }
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      }
    } else if (event.action == android.view.KeyEvent.ACTION_UP && directional) {
      // Include 0 ms presses — some remotes stamp DOWN/UP with the same eventTime
      // on ultra-short taps, which previously dropped the TvDpadTap entirely.
      val completedShortTap =
        !activeDirectionalRepeated &&
          activeDirectionalKeyCode == event.keyCode &&
          event.eventTime - activeDirectionalDownAt in 0..MAX_DPAD_TAP_MS
      if (completedShortTap && !TvRemoteModule.pointerActive) {
        val tapKey = when (event.keyCode) {
          android.view.KeyEvent.KEYCODE_DPAD_UP -> "UP"
          android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"
          else -> null
        }
        if (tapKey != null) emitRemoteEvent("TvDpadTap", tapKey)
      }
      lastAcceptedDirectionalKeyCode = -1
      lastAcceptedDirectionalRepeatAt = 0L
      activeDirectionalKeyCode = -1
      activeDirectionalDownAt = 0L
      activeDirectionalRepeated = false
    }

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
      emitRemoteEvent("TvRemoteKey", key)
      // Pointer mode owns the D-pad entirely. Guide Up/Down must NOT be consumed —
      // Android's focus engine moves between guide cells; JS only handles boundaries
      // (Up → group tabs, bottom lock). Consuming Up/Down freezes guide surfing.
      if (TvRemoteModule.pointerActive) return true
    }
    return super.dispatchKeyEvent(event)
  }

  private fun emitRemoteEvent(name: String, value: String) {
    try {
      val app = application as com.facebook.react.ReactApplication
      val rc = try { app.reactHost?.currentReactContext } catch (e: Throwable) { null }
        ?: try { app.reactNativeHost.reactInstanceManager.currentReactContext } catch (e: Throwable) { null }
      rc?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit(name, value)
    } catch (_: Throwable) {}
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Prevent Android TV / Fire TV from dimming, sleeping, or launching a
    // screensaver while CharmIPTV is active. Playback screens inherit this
    // window flag automatically, so a long-running channel remains awake.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun onDestroy() {
    // Static remote flags must never survive an Activity/bridge teardown.
    // A stale pointer flag consumes every D-pad key before Android focus sees it.
    TvRemoteModule.pointerActive = false
    TvRemoteModule.guideNavigationActive = false
    super.onDestroy()
  }

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              super.invokeDefaultOnBackPressed()
          }
          return
      }
      super.invokeDefaultOnBackPressed()
  }

  companion object {
    // 48 ms keeps held navigation visibly fast (~21 moves/sec) while giving
    // Fabric/FlashList time to mount the next native focus target.
    private const val MIN_DPAD_REPEAT_MS = 48L
    private const val MAX_DPAD_TAP_MS = 560L
  }
}
