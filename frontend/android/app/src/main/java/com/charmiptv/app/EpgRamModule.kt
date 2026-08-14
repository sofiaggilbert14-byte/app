package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Experimental RAM serving layer. SQLite stays authoritative and is never cleared here. */
class EpgRamModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val runtime = EpgRamRuntime.get(reactContext)
  private val database = runtime.database
  private val engine = runtime.engine
  private val worker = Executors.newSingleThreadExecutor()
  private val queryPool = Executors.newFixedThreadPool(2)
  private val warmQueued = AtomicBoolean(false)
  private val sqliteFallbackCount = AtomicLong(0L)
  private val guideQueryCount = AtomicLong(0L)
  private val guideQueryDurationMs = AtomicLong(0L)

  override fun getName(): String = "CharmEpgRam"

  @ReactMethod
  fun warm(startMs: Double, endMs: Double, promise: Promise) {
    worker.execute {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      try {
        if (isWarmForCurrentEpoch()) {
          promise.resolve(true)
          return@execute
        }
        val warmed = engine.rebuild(startMs.toLong(), endMs.toLong())
        if (warmed) runtime.warmGuideEpoch = currentGuideEpoch()
        promise.resolve(warmed)
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun replaceMatches(matches: ReadableArray, promise: Promise) {
    worker.execute {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      try {
        val rows = ArrayList<PlaylistEpgMatchRow>(matches.size())
        for (i in 0 until matches.size()) {
          val map = matches.getMap(i) ?: continue
          val playlistId = map.getString("playlistId")?.trim().orEmpty()
          if (playlistId.isEmpty()) continue
          rows.add(
            PlaylistEpgMatchRow(
              playlistId = playlistId,
              xmltvId = map.getString("xmltvId")?.trim().orEmpty(),
              logoXmltvId = map.getString("logoXmltvId")?.trim().orEmpty(),
              ambiguous = if (map.hasKey("ambiguous")) map.getBoolean("ambiguous") else false,
              matchPolicy = map.getString("matchPolicy")?.trim().orEmpty().ifEmpty { "full" },
              manual = if (map.hasKey("manual")) map.getBoolean("manual") else false,
            )
          )
        }
        val guideEpoch = currentGuideEpoch()
        engine.replaceMatches(rows)
        if (engine.isWarm() && runtime.warmGuideEpoch != guideEpoch) {
          // A match-table update must never bless programme objects from the
          // previous guide epoch. Consume the fresh parse handoff (or SQLite)
          // first; queries use SQLite fallback until that replacement succeeds.
          val now = System.currentTimeMillis()
          if (engine.rebuild(now - GUIDE_HISTORY_MS, now + GUIDE_WINDOW_MS)) {
            runtime.warmGuideEpoch = guideEpoch
          }
        } else if (engine.isWarm()) {
          runtime.warmGuideEpoch = guideEpoch
        }
        promise.resolve(true)
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun queryGuideWindow(startMs: Double, endMs: Double, playlistChannelIds: ReadableArray, promise: Promise) {
    queryPool.execute {
      val startedAt = System.currentTimeMillis()
      try {
        if (!isWarmForCurrentEpoch()) {
          scheduleWarmForCurrentEpoch()
          sqliteFallbackCount.incrementAndGet()
          promise.resolve(null)
          return@execute
        }
        val ids = readIds(playlistChannelIds)
        val programmes = engine.queryGuideWindow(startMs.toLong(), endMs.toLong(), ids)
        if (programmes == null) {
          sqliteFallbackCount.incrementAndGet()
          promise.resolve(null)
        } else {
          promise.resolve(groupProgramsByOutput(programmes))
        }
      } catch (_: Throwable) {
        sqliteFallbackCount.incrementAndGet()
        promise.resolve(null)
      } finally {
        guideQueryCount.incrementAndGet()
        guideQueryDurationMs.addAndGet(System.currentTimeMillis() - startedAt)
      }
    }
  }

  @ReactMethod
  fun getWindow(startMs: Double, endMs: Double, channelIds: ReadableArray, promise: Promise) {
    queryPool.execute {
      try {
        if (!isWarmForCurrentEpoch()) {
          scheduleWarmForCurrentEpoch()
          promise.resolve(null)
          return@execute
        }
        val ids = readIds(channelIds)
        val programmes = engine.queryWindow(startMs.toLong(), endMs.toLong(), ids)
        if (programmes == null) promise.resolve(null) else promise.resolve(groupPrograms(programmes))
      } catch (_: Throwable) {
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun clearMemory(promise: Promise) {
    SharedParsedEpgSnapshot.clear()
    engine.clear()
    runtime.warmGuideEpoch = -1L
    promise.resolve(true)
  }

  @ReactMethod
  fun stats(promise: Promise) {
    val result = Arguments.createMap()
    for ((key, value) in engine.stats()) result.putDouble(key, value.toDouble())
    result.putBoolean("warm", engine.isWarm())
    result.putDouble("guideEpoch", runtime.warmGuideEpoch.toDouble())
    result.putDouble("sqliteFallbackCount", sqliteFallbackCount.get().toDouble())
    result.putDouble("guideQueryCount", guideQueryCount.get().toDouble())
    result.putDouble("guideQueryDurationMs", guideQueryDurationMs.get().toDouble())
    promise.resolve(result)
  }

  private fun isWarmForCurrentEpoch(): Boolean {
    val epoch = currentGuideEpoch()
    return engine.isWarm() && runtime.warmGuideEpoch == epoch
  }

  private fun scheduleWarmForCurrentEpoch() {
    if (!warmQueued.compareAndSet(false, true)) return
    worker.execute {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      try {
        val epoch = currentGuideEpoch()
        if (engine.isWarm() && runtime.warmGuideEpoch == epoch) return@execute
        val now = System.currentTimeMillis()
        if (engine.rebuild(now - GUIDE_HISTORY_MS, now + GUIDE_WINDOW_MS)) {
          runtime.warmGuideEpoch = epoch
        }
      } finally {
        warmQueued.set(false)
      }
    }
  }

  private fun currentGuideEpoch(): Long = database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L

  private fun readIds(array: ReadableArray): List<String> {
    val ids = ArrayList<String>(array.size())
    for (i in 0 until array.size()) {
      val id = array.getString(i)?.trim()
      if (!id.isNullOrEmpty()) ids.add(id)
    }
    return ids
  }

  private fun programToMap(program: NativeEpgProgram) = Arguments.createMap().apply {
    putString("channelId", program.channelId)
    putString("title", program.title)
    if (program.description != null) putString("description", program.description) else putNull("description")
    if (!program.category.isNullOrBlank()) putString("category", program.category) else putNull("category")
    putDouble("startMs", program.startMs.toDouble())
    putDouble("endMs", program.endMs.toDouble())
  }

  private fun groupPrograms(programmes: List<NativeEpgProgram>): WritableMap {
    val grouped = Arguments.createMap()
    val arrays = HashMap<String, WritableArray>()
    for (program in programmes) {
      arrays.getOrPut(program.channelId) { Arguments.createArray() }.pushMap(programToMap(program))
    }
    for ((channelId, array) in arrays) grouped.putArray(channelId, array)
    return grouped
  }

  private fun groupProgramsByOutput(programmes: Map<String, List<NativeEpgProgram>>): WritableMap {
    val grouped = Arguments.createMap()
    for ((playlistId, rows) in programmes) {
      val array = Arguments.createArray()
      for (program in rows) {
        array.pushMap(Arguments.createMap().apply {
          putString("channelId", playlistId)
          putString("title", program.title)
          if (program.description != null) putString("description", program.description) else putNull("description")
          if (!program.category.isNullOrBlank()) putString("category", program.category) else putNull("category")
          putDouble("startMs", program.startMs.toDouble())
          putDouble("endMs", program.endMs.toDouble())
        })
      }
      grouped.putArray(playlistId, array)
    }
    return grouped
  }

  override fun invalidate() {
    SharedParsedEpgSnapshot.clear()
    engine.clear(0L)
    worker.shutdownNow()
    queryPool.shutdownNow()
    super.invalidate()
  }

  companion object {
    private const val GUIDE_HISTORY_MS = 6L * 60L * 60L * 1000L
    private const val GUIDE_WINDOW_MS = 24L * 60L * 60L * 1000L
  }
}
