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

  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
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
        emitRemoteEvent("TvGuidePageKey", pageKey)
        return true
      }
    }

    val directional =
      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_LEFT ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_RIGHT

    if (event.action == android.view.KeyEvent.ACTION_DOWN && directional) {
      val guideActive = TvRemoteModule.guideNavigationActive && !TvRemoteModule.pointerActive
      if (event.repeatCount == 0) {
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      } else {
        val elapsed = event.eventTime - lastAcceptedDirectionalRepeatAt
        val sameDirection = event.keyCode == lastAcceptedDirectionalKeyCode
        if (sameDirection) {
          val repeatFloor = if (guideActive) TvRemoteModule.guideRepeatIntervalMs else MIN_DPAD_REPEAT_MS
          if (elapsed < repeatFloor) return true
        }
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      }
    } else if (event.action == android.view.KeyEvent.ACTION_UP && directional) {
      lastAcceptedDirectionalKeyCode = -1
      lastAcceptedDirectionalRepeatAt = 0L
      TvRemoteModule.pendingLogicalGuideKey = null
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
      if (TvRemoteModule.pointerActive) return true
    }

    if (
      key != null && directional &&
        TvRemoteModule.guideNavigationActive &&
        TvRemoteModule.guideLogicalNavigationActive &&
        !TvRemoteModule.pointerActive
    ) {
      if (TvRemoteModule.guideLogicalFocusPending) {
        val pendingSince = TvRemoteModule.guideLogicalFocusPendingSinceMs
        val pendingAge = if (pendingSince > 0L) event.eventTime - pendingSince else 0L
        if (pendingSince > 0L && pendingAge >= LOGICAL_FOCUS_ACK_TIMEOUT_MS) {
          TvRemoteModule.guideLogicalFocusPending = false
          TvRemoteModule.guideLogicalFocusPendingSinceMs = 0L
          TvRemoteModule.pendingLogicalGuideKey = null
        } else {
          TvRemoteModule.pendingLogicalGuideKey = key
          return true
        }
      }
      TvRemoteModule.guideLogicalFocusPending = true
      TvRemoteModule.guideLogicalFocusPendingSinceMs = event.eventTime
      emitRemoteEvent("TvGuideLogicalKey", key)
      return true
    }

    if (
      event.action == android.view.KeyEvent.ACTION_UP && directional &&
        TvRemoteModule.guideNavigationActive &&
        TvRemoteModule.guideLogicalNavigationActive &&
        !TvRemoteModule.pointerActive
    ) return true

    return super.dispatchKeyEvent(event)
  }

  private fun emitRemoteEvent(name: String, value: String) {
    try {
      val app = application as com.facebook.react.ReactApplication
      val rc = try { app.reactHost?.currentReactContext } catch (_: Throwable) { null }
        ?: try { app.reactNativeHost.reactInstanceManager.currentReactContext } catch (_: Throwable) { null }
      rc?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit(name, value)
    } catch (_: Throwable) {}
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun onDestroy() {
    TvRemoteModule.pointerActive = false
    TvRemoteModule.guideNavigationActive = false
    TvRemoteModule.guideLogicalNavigationActive = false
    TvRemoteModule.guideLogicalFocusPending = false
    TvRemoteModule.guideLogicalFocusPendingSinceMs = 0L
    TvRemoteModule.pendingLogicalGuideKey = null
    super.onDestroy()
  }

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {}
    )
  }

  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) super.invokeDefaultOnBackPressed()
      return
    }
    super.invokeDefaultOnBackPressed()
  }

  companion object {
    private const val MIN_DPAD_REPEAT_MS = 48L
    private const val LOGICAL_FOCUS_ACK_TIMEOUT_MS = 650L
  }
}
