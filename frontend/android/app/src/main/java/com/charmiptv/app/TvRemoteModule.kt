package com.charmiptv.app

import android.os.SystemClock
import android.view.MotionEvent
import android.media.MediaCodecList
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

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
    @JvmField
    var remoteContext: String = "default"
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
  fun setRemoteContext(context: String) {
    remoteContext = when (context) {
      "guide", "guide_groups", "main_drawer", "drawer_edge", "player", "modal" -> context
      else -> "default"
    }
  }

  @ReactMethod
  fun getDeviceMemoryProfile(promise: Promise) {
    try {
      val memory = CharmMemoryCoordinator.budgets()
      promise.resolve(Arguments.createMap().apply {
        putInt("memoryClassMb", memory.memoryClassMb)
        putBoolean("lowRamDevice", memory.lowRam)
        putDouble("epgBytes", memory.epgBytes.toDouble())
        putDouble("logoMemoryBytes", memory.logoMemoryBytes.toDouble())
        putDouble("playerCacheBytes", memory.playerCacheBytes.toDouble())
        putDouble("vodCacheBytes", memory.vodCacheBytes.toDouble())
      })
    } catch (t: Throwable) {
      promise.reject("MEMORY_PROFILE_FAILED", t.message ?: "Memory profile unavailable", t)
    }
  }

  @ReactMethod
  fun tap(x: Double, y: Double) {
    val activity = ctx.getCurrentActivity() ?: return
    activity.runOnUiThread {
      try {
        val root = activity.window.decorView
        val t = SystemClock.uptimeMillis()
        // React Native coordinates are density-independent; MotionEvent uses
        // physical window pixels.
        val density = root.resources.displayMetrics.density
        val px = (x * density).toFloat()
        val py = (y * density).toFloat()
        val down = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, px, py, 0)
        val up = MotionEvent.obtain(t, t + 40, MotionEvent.ACTION_UP, px, py, 0)
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

  @ReactMethod
  fun setPlaybackStarting(starting: Boolean) {
    CharmMemoryCoordinator.setPlaybackStarting(starting)
  }

  @ReactMethod
  fun getCacheStorageReport(promise: Promise) {
    try {
      val logo = File(ctx.cacheDir, "charm-channel-logos")
      val databases = ctx.databaseList().map(ctx::getDatabasePath)
      val logoBytes = directoryBytes(logo)
      val cacheBytes = directoryBytes(ctx.cacheDir)
      val databaseBytes = databases.sumOf(::fileFamilyBytes)
      promise.resolve(Arguments.createMap().apply {
        putDouble("logoDiskBytes", logoBytes.toDouble())
        putDouble("cacheDiskBytes", cacheBytes.toDouble())
        putDouble("databaseBytes", databaseBytes.toDouble())
        putDouble("totalDiskBytes", (cacheBytes + databaseBytes).toDouble())
      })
    } catch (t: Throwable) {
      promise.reject("CACHE_REPORT_FAILED", t.message ?: "Cache report unavailable", t)
    }
  }

  @ReactMethod
  fun pruneDiskCaches(maxAgeDays: Double, promise: Promise) {
    try {
      val cutoff = System.currentTimeMillis() - maxAgeDays.toLong().coerceIn(1L, 90L) * 86_400_000L
      val protectedCutoff = System.currentTimeMillis() - 120_000L
      var removedFiles = 0L
      var removedBytes = 0L
      ctx.cacheDir.walkBottomUp().forEach { file ->
        if (!file.isFile || file.lastModified() >= cutoff || file.lastModified() >= protectedCutoff) return@forEach
        val bytes = file.length()
        if (file.delete()) {
          removedFiles += 1L
          removedBytes += bytes
        }
      }
      promise.resolve(Arguments.createMap().apply {
        putDouble("removedFiles", removedFiles.toDouble())
        putDouble("removedBytes", removedBytes.toDouble())
      })
    } catch (t: Throwable) {
      promise.reject("CACHE_PRUNE_FAILED", t.message ?: "Cache pruning failed", t)
    }
  }

  private fun directoryBytes(root: File): Long =
    if (!root.exists()) 0L else root.walkTopDown().filter(File::isFile).sumOf(File::length)

  private fun fileFamilyBytes(file: File): Long = listOf(
    file,
    File(file.path + "-wal"),
    File(file.path + "-shm"),
  ).sumOf { if (it.exists()) it.length() else 0L }

  // Required so JS NativeEventEmitter doesn't warn.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

}
