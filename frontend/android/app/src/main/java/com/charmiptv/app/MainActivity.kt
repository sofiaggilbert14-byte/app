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

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
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

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
