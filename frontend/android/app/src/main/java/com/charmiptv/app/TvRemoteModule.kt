package com.charmiptv.app

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
    var guideLogicalNavigationActive: Boolean = false
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
    if (!active) guideLogicalNavigationActive = false
  }

  @ReactMethod
  fun setGuideLogicalNavigationActive(active: Boolean) {
    guideLogicalNavigationActive = active
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

  /** One-shot diagnostic report; never probe codecs while changing channels. */
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
              // Some vendor codecs publish Integer.MAX_VALUE-like ranges.
              // Ignore those rather than displaying a fictitious resolution.
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
      val result = Arguments.createMap().apply {
        putBoolean("h264", mimeTypes.contains("video/avc"))
        putBoolean("hevc", mimeTypes.contains("video/hevc"))
        putBoolean("vp9", mimeTypes.contains("video/x-vnd.on2.vp9"))
        putBoolean("av1", mimeTypes.contains("video/av01"))
        putBoolean("aac", mimeTypes.contains("audio/mp4a-latm"))
        putBoolean("ac3", mimeTypes.contains("audio/ac3"))
        putBoolean("eac3", mimeTypes.contains("audio/eac3") || mimeTypes.contains("audio/eac3-joc"))
        putInt("maxWidth", maxWidth)
        putInt("maxHeight", maxHeight)
      }
      promise.resolve(result)
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
