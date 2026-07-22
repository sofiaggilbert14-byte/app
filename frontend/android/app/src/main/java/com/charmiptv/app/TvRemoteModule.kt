package com.charmiptv.app

import android.os.SystemClock
import android.view.MotionEvent
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
  }

  @ReactMethod
  fun setPointerActive(active: Boolean) {
    pointerActive = active
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

  // Required so JS NativeEventEmitter doesn't warn.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
