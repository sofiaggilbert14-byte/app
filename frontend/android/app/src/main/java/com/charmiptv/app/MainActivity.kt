package com.charmiptv.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import kotlin.math.abs
import kotlin.math.max

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {

  private var lastAcceptedDirectionalRepeatAt = 0L
  private var lastAcceptedDirectionalKeyCode = -1

  private fun hasSafeGuideVerticalTarget(direction: Int): Boolean {
    val source = currentFocus ?: return false
    val target = try { source.focusSearch(direction) } catch (_: Throwable) { null } ?: return false
    if (target === source || !target.isShown || !target.isFocusable || !target.isEnabled) return false
    return try {
      val sourceLoc = IntArray(2)
      val targetLoc = IntArray(2)
      source.getLocationOnScreen(sourceLoc)
      target.getLocationOnScreen(targetLoc)
      val sourceCenterX = sourceLoc[0] + source.width / 2f
      val targetCenterX = targetLoc[0] + target.width / 2f
      val sourceCenterY = sourceLoc[1] + source.height / 2f
      val targetCenterY = targetLoc[1] + target.height / 2f
      val horizontalJump = abs(targetCenterX - sourceCenterX)
      val verticalJump = abs(targetCenterY - sourceCenterY)
      val screenWidth = resources.displayMetrics.widthPixels.toFloat().coerceAtLeast(1f)
      val movesRequestedDirection =
        if (direction == View.FOCUS_UP) targetCenterY < sourceCenterY else targetCenterY > sourceCenterY
      movesRequestedDirection &&
        horizontalJump <= max(240f, screenWidth * 0.42f) &&
        verticalJump <= max(180f, source.height * 3f)
    } catch (_: Throwable) {
      false
    }
  }

  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    // Dedicated Channel/Page buttons provide safe one-page Guide jumps. They
    // never overload ordinary D-pad taps, so channel-by-channel focus remains
    // deterministic and a held arrow cannot accidentally trigger a page jump.
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
          // ONN/vendor key layouts can leave the Android keyCode UNKNOWN while
          // retaining Linux channel / 10-channel scan codes.
          0x192, 0x1b8 -> "UP"
          0x193, 0x1b9 -> "DOWN"
          else -> null
        }
      }
      if (pageKey != null) {
        emitRemoteEvent("TvGuidePageKey", pageKey)
        return true
      }
    }

    val directional =
      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_LEFT ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_RIGHT

    // Keep the first press and direction reversals instant. Held Guide repeats
    // use a bounded native cadence and never wait for a JS/paint acknowledgement;
    // that old cross-thread lock could release a repeat after a row was recycled.
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
          val repeatFloor = if (guideActive) TvRemoteModule.guideRepeatIntervalMs else MIN_DPAD_REPEAT_MS
          if (elapsed < repeatFloor) {
            return true
          }
        }
        if (
          guideActive &&
            sameDirection &&
            (event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
              event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN) &&
            !hasSafeGuideVerticalTarget(
              if (event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP) View.FOCUS_UP else View.FOCUS_DOWN,
            )
        ) {
          lastAcceptedDirectionalRepeatAt = event.eventTime
          return true
        }
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      }
    } else if (event.action == android.view.KeyEvent.ACTION_UP && directional) {
      lastAcceptedDirectionalKeyCode = -1
      lastAcceptedDirectionalRepeatAt = 0L
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
      // Pointer mode owns the D-pad entirely. Guide Up/Down must NOT be consumed â€”
      // Android's focus engine moves between guide cells; JS only handles boundaries
      // (Up â†’ group tabs, bottom lock). Consuming Up/Down freezes guide surfing.
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
    // Non-Guide screens retain the existing cap. Guide repeats use the
    // configurable device-profile cadence (72 ms Normal by default).
    private const val MIN_DPAD_REPEAT_MS = 48L
  }
}
