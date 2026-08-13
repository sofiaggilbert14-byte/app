package com.charmiptv.app

import java.util.concurrent.atomic.AtomicBoolean

/** Full retained EPG window in native RAM; SQLite remains durable fallback. */
internal class EpgRamEngine(private val database: EpgDatabase) {
  private data class RamProgram(
    val title: String,
    val description: String?,
    val category: String?,
    val startMs: Long,
    val endMs: Long,
  )

  private data class Snapshot(
    val byXmltvChannel: Map<String, Array<RamProgram>>,
    val playlistToXmltv: Map<String, String>,
    val startMs: Long,
    val endMs: Long,
    val programCount: Int,
    val estimatedBytes: Long,
  )

  @Volatile private var snapshot = EMPTY
  private val rebuilding = AtomicBoolean(false)

  fun clear() { snapshot = EMPTY }
  fun isWarm(): Boolean = snapshot.programCount > 0

  fun replaceMatches(rows: Collection<PlaylistEpgMatchRow>) {
    val matches = HashMap<String, String>(rows.size * 2)
    for (row in rows) {
      if (row.playlistId.isNotBlank() && row.xmltvId.isNotBlank()) {
        matches[row.playlistId] = row.xmltvId
      }
    }
    snapshot = snapshot.copy(playlistToXmltv = matches)
  }

  fun rebuild(startMs: Long, endMs: Long): Boolean {
    if (endMs <= startMs || !rebuilding.compareAndSet(false, true)) return false
    try {
      val runtime = Runtime.getRuntime()
      val reserve = maxOf(48L * MIB, (runtime.maxMemory() * 0.22).toLong())
      val hardBudget = (runtime.maxMemory() * 0.52).toLong()
      val budget = minOf(hardBudget, maxOf(16L * MIB, runtime.maxMemory() - heapUsed(runtime) - reserve))
      val grouped = LinkedHashMap<String, MutableList<RamProgram>>()
      val pool = HashMap<String, String>(4096)
      var estimated = 0L
      var count = 0

      fun pooled(value: String?): String? {
        if (value.isNullOrEmpty()) return value
        return pool[value] ?: value.also { pool[it] = it }
      }

      database.forEachProgramInWindow(startMs, endMs) { program ->
        val channelId = pooled(program.channelId) ?: return@forEachProgramInWindow
        val title = pooled(program.title) ?: ""
        val description = pooled(program.description)
        val category = pooled(program.category)
        estimated += 48L + estimateStringBytes(title) + estimateStringBytes(description) + estimateStringBytes(category)
        if (!grouped.containsKey(channelId)) estimated += estimateStringBytes(channelId) + 48L
        if (estimated > budget) throw RamBudgetExceeded()
        grouped.getOrPut(channelId) { ArrayList() }
          .add(RamProgram(title, description, category, program.startMs, program.endMs))
        count += 1
      }

      val frozen = HashMap<String, Array<RamProgram>>(grouped.size * 2)
      for ((channel, rows) in grouped) frozen[channel] = rows.toTypedArray()
      snapshot = Snapshot(frozen, database.readPlaylistEpgMatchMap(), startMs, endMs, count, estimated)
      return count > 0
    } catch (_: RamBudgetExceeded) {
      return false
    } finally {
      rebuilding.set(false)
    }
  }

  fun queryGuideWindow(startMs: Long, endMs: Long, playlistIds: Collection<String>): List<NativeEpgProgram>? {
    val current = snapshot
    if (current.programCount <= 0 || startMs < current.startMs || endMs > current.endMs) return null
    if (heapPressureCritical()) { clear(); return null }
    val result = ArrayList<NativeEpgProgram>()
    for (playlistId in playlistIds) {
      val xmltvId = current.playlistToXmltv[playlistId] ?: continue
      val rows = current.byXmltvChannel[xmltvId] ?: continue
      appendWindow(rows, playlistId, startMs, endMs, result)
    }
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
    )
  }

  private fun appendWindow(rows: Array<RamProgram>, outputId: String, startMs: Long, endMs: Long, out: MutableList<NativeEpgProgram>) {
    var index = firstOverlap(rows, startMs)
    if (index < 0) return
    while (index < rows.size) {
      val row = rows[index]
      if (row.startMs >= endMs) break
      if (row.endMs > startMs) out.add(NativeEpgProgram(outputId, row.title, row.description, row.category, row.startMs, row.endMs))
      index += 1
    }
  }

  private fun firstOverlap(rows: Array<RamProgram>, timeMs: Long): Int {
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
  private class RamBudgetExceeded : RuntimeException()

  companion object {
    private const val MIB = 1024L * 1024L
    private val EMPTY = Snapshot(emptyMap(), emptyMap(), 0L, 0L, 0, 0L)
  }
}
