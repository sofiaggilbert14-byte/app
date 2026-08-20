package com.charmiptv.app

import android.app.ActivityManager
import android.content.Context

internal enum class CharmTrimLevel { BACKGROUND, MODERATE, CRITICAL }

internal data class CharmMemoryBudgets(
  val memoryClassMb: Int,
  val lowRam: Boolean,
  val epgBytes: Long,
  val logoMemoryBytes: Long,
  val playerCacheBytes: Long,
  val vodCacheBytes: Long,
)

internal object CharmMemoryCoordinator {
  @Volatile private var budgets = CharmMemoryBudgets(192, false, 48L shl 20, 24L shl 20, 32L shl 20, 32L shl 20)
  @Volatile private var playbackStartingUntilMs = 0L
  private val listeners = LinkedHashSet<(CharmTrimLevel, CharmMemoryBudgets) -> Unit>()

  fun initialize(context: Context) {
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val memoryClass = manager.memoryClass.coerceAtLeast(64)
    val lowRam = manager.isLowRamDevice || memoryClass < 192
    val totalBytes = memoryClass.toLong() * 1024L * 1024L
    budgets = CharmMemoryBudgets(
      memoryClassMb = memoryClass,
      lowRam = lowRam,
      epgBytes = minOf(if (lowRam) 24L shl 20 else 64L shl 20, totalBytes / 6L),
      logoMemoryBytes = minOf(if (lowRam) 12L shl 20 else 32L shl 20, totalBytes / 10L),
      playerCacheBytes = minOf(if (lowRam) 16L shl 20 else 48L shl 20, totalBytes / 8L),
      vodCacheBytes = minOf(if (lowRam) 12L shl 20 else 64L shl 20, totalBytes / 8L),
    )
  }

  fun budgets(): CharmMemoryBudgets = budgets

  fun setPlaybackStarting(starting: Boolean) {
    playbackStartingUntilMs = if (starting) System.currentTimeMillis() + 15_000L else 0L
  }

  fun register(listener: (CharmTrimLevel, CharmMemoryBudgets) -> Unit): () -> Unit = synchronized(listeners) {
    listeners.add(listener)
    return@synchronized { synchronized(listeners) { listeners.remove(listener) } }
  }

  fun trim(level: CharmTrimLevel) {
    // Delay background/moderate cleanup during decoder startup. Critical
    // pressure always wins so Android does not kill the process outright.
    if (level != CharmTrimLevel.CRITICAL && System.currentTimeMillis() < playbackStartingUntilMs) return
    val snapshot = synchronized(listeners) { listeners.toList() }
    for (listener in snapshot) runCatching { listener(level, budgets) }
  }
}
