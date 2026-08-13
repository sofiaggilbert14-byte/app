package com.charmiptv.app

/**
 * Small native RAM hot cache for Guide surfing.
 *
 * SQLite remains the authoritative store. This cache only keeps recently requested
 * playlist-channel windows in memory so held D-pad movement can reuse nearby rows
 * without repeating the same JOIN/bridge work. Entries are bounded and invalidated
 * whenever the guide or playlist-to-EPG matches change.
 */
internal class EpgGuideHotCache(
  private val loader: (Long, Long, List<String>) -> List<NativeEpgProgram>,
  private val maxChannels: Int = 96,
) {
  private data class Entry(
    val startMs: Long,
    val endMs: Long,
    val programs: List<NativeEpgProgram>,
  )

  private val lock = Any()
  private val byChannel = object : LinkedHashMap<String, Entry>(128, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>?): Boolean {
      return size > maxChannels
    }
  }

  fun clear() {
    synchronized(lock) { byChannel.clear() }
  }

  fun query(startMs: Long, endMs: Long, channelIds: List<String>): List<NativeEpgProgram> {
    if (channelIds.isEmpty()) return emptyList()

    val resultByChannel = LinkedHashMap<String, List<NativeEpgProgram>>(channelIds.size)
    val misses = ArrayList<String>()

    synchronized(lock) {
      for (channelId in channelIds) {
        val entry = byChannel[channelId]
        if (entry != null && entry.startMs <= startMs && entry.endMs >= endMs) {
          resultByChannel[channelId] = filterWindow(entry.programs, startMs, endMs)
        } else {
          misses.add(channelId)
        }
      }
    }

    if (misses.isNotEmpty()) {
      val loaded = loader(startMs, endMs, misses)
      val grouped = LinkedHashMap<String, MutableList<NativeEpgProgram>>(misses.size)
      for (channelId in misses) grouped[channelId] = ArrayList()
      for (program in loaded) grouped.getOrPut(program.channelId) { ArrayList() }.add(program)

      synchronized(lock) {
        for (channelId in misses) {
          val programs = grouped[channelId]?.toList() ?: emptyList()
          byChannel[channelId] = Entry(startMs, endMs, programs)
          resultByChannel[channelId] = programs
        }
      }
    }

    val flattened = ArrayList<NativeEpgProgram>()
    for (channelId in channelIds) {
      resultByChannel[channelId]?.let(flattened::addAll)
    }
    return flattened
  }

  private fun filterWindow(
    programs: List<NativeEpgProgram>,
    startMs: Long,
    endMs: Long,
  ): List<NativeEpgProgram> {
    if (programs.isEmpty()) return emptyList()
    return programs.filter { it.endMs > startMs && it.startMs < endMs }
  }
}
