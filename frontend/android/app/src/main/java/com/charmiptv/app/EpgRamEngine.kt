package com.charmiptv.app

/** Channel-scoped hot cache. SQLite remains authoritative and complete. */
internal class EpgRamEngine(private val database: EpgDatabase) {
  private data class Entry(
    val programmes: Array<NativeEpgProgram>,
    val startMs: Long,
    val endMs: Long,
    val loadedAtMs: Long,
    val estimatedBytes: Long,
  )

  private val lock = Any()
  private val entries = LinkedHashMap<String, Entry>(64, 0.75f, true)
  private var playlistToXmltv: Map<String, String> = emptyMap()
  private var estimatedBytes = 0L
  private val unregisterMemoryListener = CharmMemoryCoordinator.register { level, _ ->
    when (level) {
      CharmTrimLevel.BACKGROUND -> synchronized(lock) { trimFraction(0.75) }
      CharmTrimLevel.MODERATE -> synchronized(lock) { trimFraction(0.4) }
      CharmTrimLevel.CRITICAL -> clear()
    }
  }

  fun clear(cooldownMs: Long = 0L) = synchronized(lock) {
    entries.clear()
    estimatedBytes = 0L
  }

  fun clearPrograms() = clear()
  fun dispose() {
    unregisterMemoryListener()
    clear()
  }
  fun isWarm(): Boolean = synchronized(lock) { entries.isNotEmpty() }
  fun hasMatches(): Boolean = synchronized(lock) { playlistToXmltv.isNotEmpty() }

  fun replaceMatches(rows: Collection<PlaylistEpgMatchRow>) = synchronized(lock) {
    val next = HashMap<String, String>(rows.size * 2)
    for (row in rows) {
      if (row.playlistId.isNotBlank() && row.xmltvId.isNotBlank()) next[row.playlistId] = row.xmltvId
    }
    playlistToXmltv = next
    val active = HashSet<String>(next.size * 2)
    active.addAll(next.values)
    val iterator = entries.entries.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next()
      if (entry.key !in active) {
        estimatedBytes -= entry.value.estimatedBytes
        iterator.remove()
      }
    }
  }

  fun queryGuideWindow(startMs: Long, endMs: Long, playlistIds: Collection<String>): List<NativeEpgProgram>? {
    val mapping = synchronized(lock) { playlistToXmltv }
    if (mapping.isEmpty()) return null
    // Build one insertion-ordered set instead of mapNotNull().distinct(), which
    // creates multiple short-lived lists on every native Guide runway query.
    val xmltvIds = LinkedHashSet<String>()
    for (playlistId in playlistIds) {
      val xmltvId = mapping[playlistId]
      if (!xmltvId.isNullOrBlank()) xmltvIds.add(xmltvId)
    }
    if (xmltvIds.isEmpty()) return emptyList()
    ensureChannels(xmltvIds, startMs, endMs)
    val result = ArrayList<NativeEpgProgram>()
    synchronized(lock) {
      for (playlistId in playlistIds) {
        val xmltvId = mapping[playlistId] ?: continue
        appendWindow(entries[xmltvId]?.programmes ?: continue, playlistId, startMs, endMs, result)
      }
    }
    return result
  }

  fun queryWindow(startMs: Long, endMs: Long, xmltvIds: Collection<String>): List<NativeEpgProgram>? {
    val unique = LinkedHashSet<String>()
    for (id in xmltvIds) if (id.isNotBlank()) unique.add(id)
    if (unique.isEmpty()) return emptyList()
    ensureChannels(unique, startMs, endMs)
    val result = ArrayList<NativeEpgProgram>()
    synchronized(lock) {
      for (id in unique) appendWindow(entries[id]?.programmes ?: continue, id, startMs, endMs, result)
    }
    return result
  }

  private fun ensureChannels(ids: Collection<String>, startMs: Long, endMs: Long) {
    if (endMs <= startMs) return
    val now = System.currentTimeMillis()
    val missing = ArrayList<String>()
    synchronized(lock) {
      evictExpired(now)
      for (id in ids) {
        val entry = entries[id]
        if (entry == null || startMs < entry.startMs || endMs > entry.endMs) missing.add(id)
      }
    }
    if (missing.isEmpty()) return

    val rows = database.queryWindow(startMs, endMs, missing)
    // Avoid Kotlin groupBy(): it allocates a Map + List wrapper graph over every
    // programme while the original SQLite result list is still live. Fill only
    // the requested per-channel arrays through mutable buckets, then release the
    // source list as soon as this function returns.
    val grouped = HashMap<String, ArrayList<NativeEpgProgram>>(missing.size * 2)
    for (row in rows) grouped.getOrPut(row.channelId) { ArrayList() }.add(row)

    synchronized(lock) {
      for (id in missing) {
        entries.remove(id)?.let { estimatedBytes -= it.estimatedBytes }
        val list = grouped[id]
        val programmes = if (list.isNullOrEmpty()) emptyArray() else list.toTypedArray()
        var bytes = 0L
        for (programme in programmes) bytes += estimateProgramBytes(programme)
        entries[id] = Entry(programmes, startMs, endMs, now, bytes)
        estimatedBytes += bytes
      }
      trimToBudget()
    }
  }

  private fun evictExpired(now: Long) {
    val iterator = entries.entries.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next()
      if (now - entry.value.loadedAtMs > ENTRY_TTL_MS) {
        estimatedBytes -= entry.value.estimatedBytes
        iterator.remove()
      }
    }
  }

  private fun trimToBudget() {
    val runtime = Runtime.getRuntime()
    val coordinated = CharmMemoryCoordinator.budgets()
    val byteBudget = minOf(MAX_CACHE_BYTES, coordinated.epgBytes, (runtime.maxMemory() * 0.18).toLong())
    val channelLimit = if (coordinated.lowRam || runtime.maxMemory() < LOW_MEMORY_CLASS_BYTES) LOW_RAM_CHANNEL_LIMIT else CHANNEL_LIMIT
    val iterator = entries.entries.iterator()
    while ((entries.size > channelLimit || estimatedBytes > byteBudget) && iterator.hasNext()) {
      val entry = iterator.next()
      estimatedBytes -= entry.value.estimatedBytes
      iterator.remove()
    }
  }

  private fun trimFraction(keepFraction: Double) {
    val target = (estimatedBytes * keepFraction.coerceIn(0.0, 1.0)).toLong()
    val iterator = entries.entries.iterator()
    while (estimatedBytes > target && iterator.hasNext()) {
      val entry = iterator.next()
      estimatedBytes -= entry.value.estimatedBytes
      iterator.remove()
    }
  }

  fun stats(): Map<String, Long> = synchronized(lock) {
    val runtime = Runtime.getRuntime()
    var programmeCount = 0L
    for (entry in entries.values) programmeCount += entry.programmes.size.toLong()
    mapOf(
      "programCount" to programmeCount,
      "channelCount" to entries.size.toLong(),
      "matchCount" to playlistToXmltv.size.toLong(),
      "estimatedBytes" to estimatedBytes,
      "heapUsedBytes" to runtime.totalMemory() - runtime.freeMemory(),
      "heapMaxBytes" to runtime.maxMemory(),
    )
  }

  private fun appendWindow(rows: Array<NativeEpgProgram>, outputId: String, startMs: Long, endMs: Long, out: MutableList<NativeEpgProgram>) {
    var index = firstOverlap(rows, startMs)
    if (index < 0) return
    while (index < rows.size) {
      val row = rows[index]
      if (row.startMs >= endMs) break
      if (row.endMs > startMs) out.add(if (row.channelId == outputId) row else NativeEpgProgram(outputId, row.title, row.description, row.category, row.startMs, row.endMs))
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
    while (index in rows.indices && rows[index].endMs <= timeMs) index += 1
    return if (index in rows.indices) index else -1
  }

  private fun estimateProgramBytes(row: NativeEpgProgram): Long =
    56L + estimateStringBytes(row.channelId) + estimateStringBytes(row.title) +
      estimateStringBytes(row.description) + estimateStringBytes(row.category)

  private fun estimateStringBytes(value: String?) = if (value == null) 0L else 40L + value.length.toLong() * 2L

  companion object {
    private const val ENTRY_TTL_MS = 90L * 60L * 1000L
    private const val CHANNEL_LIMIT = 320
    private const val LOW_RAM_CHANNEL_LIMIT = 128
    private const val LOW_MEMORY_CLASS_BYTES = 192L * 1024L * 1024L
    private const val MAX_CACHE_BYTES = 64L * 1024L * 1024L
  }
}
