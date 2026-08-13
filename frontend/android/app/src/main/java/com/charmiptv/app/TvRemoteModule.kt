package com.charmiptv.app

import android.os.SystemClock
import android.view.MotionEvent
import android.media.MediaCodecList
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

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
    var guideLogicalFocusPending: Boolean = false
    @JvmField
    var guideLogicalFocusPendingSinceMs: Long = 0L
    @JvmField
    var pendingLogicalGuideKey: String? = null
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
    if (!active) {
      guideLogicalNavigationActive = false
      guideLogicalFocusPending = false
      guideLogicalFocusPendingSinceMs = 0L
      pendingLogicalGuideKey = null
    }
  }

  @ReactMethod
  fun setGuideLogicalNavigationActive(active: Boolean) {
    guideLogicalNavigationActive = active
    if (!active) {
      guideLogicalFocusPending = false
      guideLogicalFocusPendingSinceMs = 0L
      pendingLogicalGuideKey = null
      return
    }

    // A true call after native onFocus is the acknowledgement for the previous
    // logical focus transaction. Only then release one coalesced repeat. This
    // keeps held ONN D-pad input fast without letting JS/FlashList run several
    // focus generations ahead of the mounted Android view hierarchy.
    if (guideLogicalFocusPending) {
      guideLogicalFocusPending = false
      guideLogicalFocusPendingSinceMs = 0L
      val pending = pendingLogicalGuideKey
      pendingLogicalGuideKey = null
      if (!pending.isNullOrBlank()) {
        guideLogicalFocusPending = true
        guideLogicalFocusPendingSinceMs = SystemClock.uptimeMillis()
        emitLogicalGuideKey(pending)
      }
    }
  }

  private fun emitLogicalGuideKey(key: String) {
    try {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("TvGuideLogicalKey", key)
    } catch (_: Throwable) {}
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
