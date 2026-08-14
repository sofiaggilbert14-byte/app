package com.charmiptv.app

import android.content.Context
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal class EpgRamRuntime private constructor(context: Context) {
  val database = EpgDatabase(context.applicationContext)
  val engine = EpgRamEngine(database)
  @Volatile var warmGuideEpoch = -1L

  companion object {
    @Volatile private var instance: EpgRamRuntime? = null
    fun get(context: Context): EpgRamRuntime = instance ?: synchronized(this) {
      instance ?: EpgRamRuntime(context).also { instance = it }
    }
  }
}

/** Bounded active EPG slice in native RAM; full SQLite remains durable fallback. */
internal class EpgRamEngine(private val database: EpgDatabase) {
  private data class Snapshot(
    val byXmltvChannel: Map<String, Array<NativeEpgProgram>>,
    val playlistToXmltv: Map<String, String>,
    val startMs: Long,
    val endMs: Long,
    val programCount: Int,
    val estimatedBytes: Long,
  )

  @Volatile private var snapshot = EMPTY
  @Volatile private var rebuildAllowedAtMs = 0L
  private val rebuilding = AtomicBoolean(false)
  private val generation = AtomicLong(0L)
  private val hitCount = AtomicLong(0L)
  private val missCount = AtomicLong(0L)
  @Volatile private var lastWarmDurationMs = 0L

  /**
   * RAM is disposable. A short cooldown prevents a critical-memory trim from
   * being followed by an immediate EPG-slice rebuild on the next Guide read.
   */
  @Synchronized fun clear(cooldownMs: Long = CLEAR_REBUILD_COOLDOWN_MS) {
    generation.incrementAndGet()
    val current = snapshot
    snapshot = EMPTY.copy(playlistToXmltv = current.playlistToXmltv)
    rebuildAllowedAtMs = maxOf(rebuildAllowedAtMs, System.currentTimeMillis() + maxOf(0L, cooldownMs))
  }

  fun isWarm(): Boolean = snapshot.programCount > 0
  fun hasMatches(): Boolean = snapshot.playlistToXmltv.isNotEmpty()

  @Synchronized fun replaceMatches(rows: Collection<PlaylistEpgMatchRow>) {
    val matches = HashMap<String, String>(rows.size * 2)
    for (row in rows) {
      if (row.playlistId.isNotBlank() && row.xmltvId.isNotBlank()) {
        matches[row.playlistId] = row.xmltvId
      }
    }
    snapshot = snapshot.copy(playlistToXmltv = matches)
  }

  /** Reuse finalized parser objects; SQLite is already durable at this point. */
  fun replacePrograms(programs: List<NativeEpgProgram>, startMs: Long, endMs: Long): Boolean {
    if (programs.isEmpty() || endMs <= startMs) return false
    val buildGeneration = generation.get()
    val runtime = Runtime.getRuntime()
    val usedBeforeBuild = heapUsed(runtime)
    val reserve = maxOf(48L * MIB, (runtime.maxMemory() * 0.22).toLong())
    val hardBudget = (runtime.maxMemory() * 0.52).toLong()
    val budget = minOf(hardBudget, maxOf(16L * MIB, runtime.maxMemory() - usedBeforeBuild - reserve))
    val grouped = LinkedHashMap<String, MutableList<NativeEpgProgram>>()
    var estimated = 0L
    for (program in programs) {
      estimated += estimateProgramBytes(program)
      if (estimated > budget || heapPressureCritical()) return false
      grouped.getOrPut(program.channelId) { ArrayList() }.add(program)
    }
    val frozen = HashMap<String, Array<NativeEpgProgram>>(grouped.size * 2)
    for ((channel, rows) in grouped) frozen[channel] = rows.toTypedArray()
    synchronized(this) {
      if (generation.get() != buildGeneration) return false
      snapshot = Snapshot(frozen, snapshot.playlistToXmltv, startMs, endMs, programs.size, estimated)
      rebuildAllowedAtMs = 0L
    }
    return true
  }

  /**
   * Rebuild from the persisted last-good SQLite guide. This is local disk→RAM only.
   * The channel arrays retain the NativeEpgProgram objects returned by SQLite instead
   * of cloning every title/description into a second object graph during warm-up.
   */
  fun rebuild(startMs: Long, endMs: Long): Boolean {
    val now = System.currentTimeMillis()
    if (endMs <= startMs || now < rebuildAllowedAtMs || !rebuilding.compareAndSet(false, true)) return false
    try {
      val buildGeneration = generation.get()
      val warmStartedAt = System.currentTimeMillis()
      val runtime = Runtime.getRuntime()
      val usedBeforeBuild = heapUsed(runtime)
      if (usedBeforeBuild >= (runtime.maxMemory() * PREBUILD_PRESSURE_FRACTION).toLong()) {
        rebuildAllowedAtMs = now + FAILED_REBUILD_COOLDOWN_MS
        return false
      }
      val reserve = maxOf(48L * MIB, (runtime.maxMemory() * 0.22).toLong())
      val hardBudget = (runtime.maxMemory() * 0.52).toLong()
      val budget = minOf(hardBudget, maxOf(16L * MIB, runtime.maxMemory() - usedBeforeBuild - reserve))
      val grouped = LinkedHashMap<String, MutableList<NativeEpgProgram>>()
      var estimated = 0L
      var programCount = 0

      database.forEachProgramInWindow(startMs, endMs) { program ->
        estimated += estimateProgramBytes(program)
        if (estimated > budget || heapPressureCritical()) throw RamBudgetExceeded()
        grouped.getOrPut(program.channelId) { ArrayList() }.add(program)
        programCount += 1
      }

      val frozen = HashMap<String, Array<NativeEpgProgram>>(grouped.size * 2)
      for ((channel, rows) in grouped) frozen[channel] = rows.toTypedArray()
      val persistedMatches = database.readPlaylistEpgMatches()
      val matches = HashMap<String, String>(persistedMatches.size * 2)
      for (row in persistedMatches) {
        if (row.playlistId.isNotBlank() && row.xmltvId.isNotBlank()) matches[row.playlistId] = row.xmltvId
      }
      synchronized(this) {
        if (generation.get() != buildGeneration) return false
        snapshot = Snapshot(frozen, matches, startMs, endMs, programCount, estimated)
        rebuildAllowedAtMs = 0L
      }
      lastWarmDurationMs = System.currentTimeMillis() - warmStartedAt
      return programCount > 0
    } catch (_: RamBudgetExceeded) {
      rebuildAllowedAtMs = System.currentTimeMillis() + FAILED_REBUILD_COOLDOWN_MS
      return false
    } finally {
      rebuilding.set(false)
    }
  }

  fun queryGuideWindow(startMs: Long, endMs: Long, playlistIds: Collection<String>): Map<String, List<NativeEpgProgram>>? {
    val current = snapshot
    if (current.programCount <= 0 || current.playlistToXmltv.isEmpty() || startMs < current.startMs || endMs > current.endMs) {
      missCount.incrementAndGet()
      return null
    }
    if (heapPressureCritical()) { clear(); missCount.incrementAndGet(); return null }
    val result = LinkedHashMap<String, List<NativeEpgProgram>>()
    for (playlistId in playlistIds) {
      val xmltvId = current.playlistToXmltv[playlistId] ?: continue
      val rows = current.byXmltvChannel[xmltvId] ?: continue
      val from = firstOverlap(rows, startMs)
      if (from < 0) continue
      var to = from
      while (to < rows.size && rows[to].startMs < endMs) to += 1
      if (to > from) result[playlistId] = rows.asList().subList(from, to)
    }
    hitCount.incrementAndGet()
    return result
  }

  fun queryWindow(startMs: Long, endMs: Long, xmltvIds: Collection<String>): List<NativeEpgProgram>? {
    val current = snapshot
    if (current.programCount <= 0 || startMs < current.startMs || endMs > current.endMs) return null
    if (heapPressureCritical()) { clear(); return null }
    val result = ArrayList<NativeEpgProgram>()
    for (xmltvId in xmltvIds) {
      val rows = current.byXmltvChannel[xmltvId] ?: continue
      appendWindow(rows, xmltvId, startMs, endMs, result)
    }
    return result
  }

  fun stats(): Map<String, Long> {
    val current = snapshot
    val runtime = Runtime.getRuntime()
    return mapOf(
      "programCount" to current.programCount.toLong(),
      "channelCount" to current.byXmltvChannel.size.toLong(),
      "matchCount" to current.playlistToXmltv.size.toLong(),
      "estimatedBytes" to current.estimatedBytes,
      "heapUsedBytes" to heapUsed(runtime),
      "heapMaxBytes" to runtime.maxMemory(),
      "rebuildAllowedAtMs" to rebuildAllowedAtMs,
      "hitCount" to hitCount.get(),
      "missCount" to missCount.get(),
      "lastWarmDurationMs" to lastWarmDurationMs,
    )
  }

  private fun appendWindow(rows: Array<NativeEpgProgram>, outputId: String, startMs: Long, endMs: Long, out: MutableList<NativeEpgProgram>) {
    var index = firstOverlap(rows, startMs)
    if (index < 0) return
    while (index < rows.size) {
      val row = rows[index]
      if (row.startMs >= endMs) break
      if (row.endMs > startMs) {
        if (row.channelId == outputId) out.add(row)
        else out.add(NativeEpgProgram(outputId, row.title, row.description, row.category, row.startMs, row.endMs))
      }
      index += 1
    }
  }

  private fun firstOverlap(rows: Array<NativeEpgProgram>, timeMs: Long): Int {
    if (rows.isEmpty()) return -1
    var low = 0
    var high = rows.size
    while (low < high) {
      val mid = (low + high) ushr 1
      if (rows[mid].startMs < timeMs) low = mid + 1 else high = mid
    }
    var index = minOf(rows.lastIndex, low)
    while (index > 0 && rows[index - 1].endMs > timeMs) index -= 1
    while (index < rows.size && rows[index].endMs <= timeMs) index += 1
    return if (index < rows.size) index else -1
  }

  private fun heapPressureCritical(): Boolean {
    val runtime = Runtime.getRuntime()
    return heapUsed(runtime) >= (runtime.maxMemory() * 0.88).toLong()
  }

  private fun heapUsed(runtime: Runtime) = runtime.totalMemory() - runtime.freeMemory()
  private fun estimateStringBytes(value: String?) = if (value == null) 0L else 40L + value.length.toLong() * 2L
  private fun estimateProgramBytes(program: NativeEpgProgram) =
    56L + estimateStringBytes(program.channelId) + estimateStringBytes(program.title) +
      estimateStringBytes(program.description) + estimateStringBytes(program.category)
  private class RamBudgetExceeded : RuntimeException()

  companion object {
    private const val MIB = 1024L * 1024L
    private const val CLEAR_REBUILD_COOLDOWN_MS = 15_000L
    private const val FAILED_REBUILD_COOLDOWN_MS = 60_000L
    private const val PREBUILD_PRESSURE_FRACTION = 0.72
    private val EMPTY = Snapshot(emptyMap(), emptyMap(), 0L, 0L, 0, 0L)
  }
}
