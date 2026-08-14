package com.charmiptv.app

/**
 * One-shot in-process handoff from the completed local-file XMLTV parse to the
 * RAM engine. SQLite remains authoritative; this only avoids immediately
 * rereading the same freshly parsed guide from disk after a successful refresh.
 */
internal object SharedParsedEpgSnapshot {
  data class Snapshot(
    val programmes: List<NativeEpgProgram>,
    val startMs: Long,
    val endMs: Long,
    val createdAtMs: Long = System.currentTimeMillis(),
  )

  private val lock = Any()
  private var snapshot: Snapshot? = null

  fun publish(programmes: List<NativeEpgProgram>, startMs: Long, endMs: Long) {
    if (programmes.isEmpty() || endMs <= startMs) return
    synchronized(lock) {
      snapshot = Snapshot(programmes, startMs, endMs)
    }
  }

  fun takeIfCovers(startMs: Long, endMs: Long): Snapshot? {
    synchronized(lock) {
      val current = snapshot ?: return null
      if (System.currentTimeMillis() - current.createdAtMs > MAX_AGE_MS) {
        snapshot = null
        return null
      }
      if (startMs < current.startMs || endMs > current.endMs) return null
      snapshot = null
      return current
    }
  }

  fun clear() {
    synchronized(lock) { snapshot = null }
  }

  private const val MAX_AGE_MS = 2L * 60L * 1000L
}
