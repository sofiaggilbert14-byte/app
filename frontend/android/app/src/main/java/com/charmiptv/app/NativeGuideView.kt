package com.charmiptv.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Constant-view-count TV guide. Selection is logical coordinates, never Android focus nodes.
 * Program X/width are always derived from real start/end times against the same viewport used
 * by the header. SQLite reads follow the visible time runway so horizontal navigation cannot
 * outrun the queried EPG window and expose false empty columns.
 */
class NativeGuideView(context: Context) : View(context) {
  private data class ChannelRow(val id: String, val name: String, val number: String, val label: String)
  private data class GuideQuery(val token: Int, val startMs: Long, val endMs: Long, val ids: List<String>)

  private val database = EpgDatabase(context.applicationContext)
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "CharmGuideRead").apply { isDaemon = true } }
  private val rows = ArrayList<ChannelRow>()
  @Volatile private var programs = emptyMap<String, Array<NativeEpgProgram>>()

  private var windowStartMs = System.currentTimeMillis() - 30L * 60_000L
  private var windowEndMs = windowStartMs + 6L * 60L * 60_000L
  private var viewportStartMs = windowStartMs
  private var selectedRow = 0
  private var selectedTimeMs = System.currentTimeMillis().coerceIn(windowStartMs, windowEndMs - 1)
  private var firstVisibleRow = 0
  private var generation = 0
  @Volatile private var pendingQuery: GuideQuery? = null
  private val queryDrainScheduled = AtomicBoolean(false)
  @Volatile private var disposed = false
  private var enabled = true
  private var lastMoveAt = 0L
  private var lastHorizontalMoveAt = 0L
  private var moveVelocity = 0
  private var navigationKeyDown = false
  private var pendingRestoreChannelId: String? = null
  private var pendingRestoreTimeMs: Long? = null
  private var reloadGeneration = 0
  private val settleSelectionRunnable = Runnable {
    if (enabled && !disposed && rows.isNotEmpty()) emitSelection(true)
  }

  private val unregisterMemoryListener = CharmMemoryCoordinator.register { level, _ ->
    if (level != CharmTrimLevel.CRITICAL) return@register
    post {
      if (disposed) return@post
      programs = emptyMap()
      generation += 1
      pendingQuery = null
      loadPrograms()
      invalidate()
    }
  }

  private val density = resources.displayMetrics.density
  private val channelWidth = 184f * density
  private val headerHeight = 38f * density
  private val rowHeight = 54f * density
  private val pad = 8f * density

  /** Three visible hours gives six equal 30-minute header columns on every TV size. */
  private val visibleWindowMs = 3L * 60L * 60_000L
  private val horizontalPrefetchBeforeMs = 30L * 60_000L
  private val horizontalPrefetchAfterMs = 60L * 60_000L

  private val background = Paint().apply { color = Color.rgb(8, 7, 13) }
  private val header = Paint().apply { color = Color.rgb(22, 18, 33) }
  private val channel = Paint().apply { color = Color.rgb(26, 22, 38) }
  private val rowSurface = Paint().apply { color = Color.rgb(18, 16, 28) }
  private val cell = Paint().apply { color = Color.rgb(31, 27, 45) }
  private val selected = Paint().apply { color = Color.rgb(119, 74, 219) }
  private val divider = Paint().apply { color = Color.rgb(53, 45, 72); strokeWidth = density }
  private val nowPaint = Paint().apply { color = Color.rgb(197, 158, 255); strokeWidth = 2f * density }
  private val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 13f * density }
  private val muted = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(183, 174, 204); textSize = 11f * density }
  private val timeFormatter = SimpleDateFormat("h:mm a", Locale.getDefault())
  private val tickDate = Date()

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    setBackgroundColor(Color.BLACK)
  }

  fun setChannels(value: ReadableArray?) {
    val nextRows = ArrayList<ChannelRow>()
    if (value != null) for (index in 0 until value.size()) {
      val item = value.getMap(index) ?: continue
      val id = item.getString("id") ?: continue
      val name = item.getString("name") ?: "Channel"
      val number = item.getString("number") ?: ""
      nextRows.add(ChannelRow(id, name, number, if (number.isBlank()) name else "$number  $name"))
    }
    if (rows == nextRows) {
      applyPendingRestoreChannel()
      return
    }
    val currentRestoreId = rows.getOrNull(selectedRow)?.id
    rows.clear()
    rows.addAll(nextRows)
    val keepIds = nextRows.asSequence().map { it.id }.toHashSet()
    programs = programs.filterKeys { it in keepIds }

    val wantedId = pendingRestoreChannelId ?: currentRestoreId
    val restoreIndex = wantedId?.let { wanted -> rows.indexOfFirst { it.id == wanted } } ?: -1
    selectedRow = if (restoreIndex >= 0) restoreIndex else selectedRow.coerceIn(0, max(0, rows.lastIndex))
    if (restoreIndex >= 0 && wantedId == pendingRestoreChannelId) pendingRestoreChannelId = null
    if (rows.isEmpty()) selectedRow = 0
    ensureVisible()
    loadPrograms()
    invalidate()
    if (enabled && rows.isNotEmpty()) emitSelection(true)
  }

  fun setWindow(start: Double, end: Double) {
    val nextStart = start.toLong()
    val nextEnd = end.toLong()
    if (nextEnd <= nextStart) return
    val changed = nextStart != windowStartMs || nextEnd != windowEndMs
    windowStartMs = nextStart
    windowEndMs = nextEnd

    val pending = pendingRestoreTimeMs
    if (pending != null && pending >= windowStartMs && pending < windowEndMs) {
      selectedTimeMs = pending
      pendingRestoreTimeMs = null
    } else {
      selectedTimeMs = selectedTimeMs.coerceIn(windowStartMs, windowEndMs - 1)
    }
    viewportStartMs = clampViewportStart(viewportStartMs)
    if (selectedTimeMs < viewportStartMs || selectedTimeMs >= viewportEndMs()) {
      viewportStartMs = clampViewportStart(selectedTimeMs - 15L * 60_000L)
    }
    if (changed || pendingRestoreTimeMs == null) loadPrograms()
    invalidate()
  }

  fun setWindowStart(start: Double) = setWindow(start, windowEndMs.toDouble())
  fun setWindowEnd(end: Double) = setWindow(windowStartMs.toDouble(), end)

  fun setActive(value: Boolean) {
    enabled = value
    if (!value) {
      removeCallbacks(settleSelectionRunnable)
      navigationKeyDown = false
      moveVelocity = 0
    }
    if (value) {
      applyPendingRestoreChannel()
      if (rows.isNotEmpty()) {
        requestFocus()
        emitSelection(true)
      }
    }
  }

  fun restoreChannel(channelId: String?) {
    val wanted = channelId?.trim().orEmpty()
    if (wanted.isEmpty()) return
    pendingRestoreChannelId = wanted
    applyPendingRestoreChannel()
  }

  private fun applyPendingRestoreChannel() {
    val wanted = pendingRestoreChannelId ?: return
    val index = rows.indexOfFirst { it.id == wanted }
    if (index < 0) return
    pendingRestoreChannelId = null
    selectedRow = index
    ensureVisible()
    loadPrograms()
    invalidate()
    if (enabled) emitSelection(true)
  }

  fun setReloadGeneration(value: Int) {
    if (value == reloadGeneration) return
    removeCallbacks(settleSelectionRunnable)
    reloadGeneration = value
    generation += 1
    pendingQuery = null
    // Logical Guide resets (group switch/Search/fullscreen return) keep the
    // same native view and cursor, but must always request a fresh bounded
    // visible runway even when the channel array itself is unchanged.
    loadPrograms()
    invalidate()
    if (enabled && rows.isNotEmpty()) emitSelection(true)
  }

  fun restoreTime(value: Double) {
    if (!value.isFinite() || value <= 0.0) return
    val wanted = value.toLong()
    pendingRestoreTimeMs = wanted
    if (windowEndMs <= windowStartMs || wanted < windowStartMs || wanted >= windowEndMs) return
    pendingRestoreTimeMs = null
    if (wanted == selectedTimeMs) return
    selectedTimeMs = wanted
    viewportStartMs = clampViewportStart(selectedTimeMs - visibleWindowMs / 6L)
    loadPrograms()
    invalidate()
    if (enabled) emitSelection(true)
  }

  private fun clampViewportStart(value: Long): Long {
    val latest = max(windowStartMs, windowEndMs - visibleWindowMs)
    return value.coerceIn(windowStartMs, latest)
  }

  private fun viewportEndMs(): Long = min(windowEndMs, viewportStartMs + visibleWindowMs)

  private fun ensureSelectedTimeVisible() {
    val end = viewportEndMs()
    val rightGuard = viewportStartMs + (visibleWindowMs * 5L / 6L)
    val leftGuard = viewportStartMs + (visibleWindowMs / 6L)
    val next = when {
      selectedTimeMs >= rightGuard -> selectedTimeMs - (visibleWindowMs * 2L / 3L)
      selectedTimeMs < leftGuard -> selectedTimeMs - (visibleWindowMs / 6L)
      selectedTimeMs >= end -> selectedTimeMs - (visibleWindowMs * 2L / 3L)
      else -> viewportStartMs
    }
    val clamped = clampViewportStart(next)
    if (clamped != viewportStartMs) {
      viewportStartMs = clamped
      loadPrograms()
    }
  }

  private fun loadPrograms() {
    if (disposed || io.isShutdown) return
    val visible = max(6, ((height - headerHeight) / rowHeight).toInt())
    val ahead = 8 + min(28, moveVelocity * 2)
    val from = max(0, firstVisibleRow - ahead)
    val to = min(rows.size, firstVisibleRow + visible + ahead)
    val ids = rows.subList(from, to).map { it.id }
    if (ids.isEmpty()) {
      generation += 1
      pendingQuery = null
      programs = emptyMap()
      return
    }

    val queryStart = max(windowStartMs, viewportStartMs - horizontalPrefetchBeforeMs)
    val queryEnd = min(windowEndMs, viewportEndMs() + horizontalPrefetchAfterMs)
    pendingQuery = GuideQuery(++generation, queryStart, queryEnd, ids)
    scheduleQueryDrain()
  }

  /** Keep at most one active read plus the newest requested runway. */
  private fun scheduleQueryDrain() {
    if (disposed || io.isShutdown || !queryDrainScheduled.compareAndSet(false, true)) return
    io.execute {
      try {
        while (!disposed) {
          val request = pendingQuery ?: break
          pendingQuery = null
          // A table swap during EPG refresh can briefly make a read fail. Keep
          // the last-good painted rows instead of replacing the canvas with an
          // empty map (the reported black-guide failure).
          val loaded = try { database.queryGuideWindow(request.startMs, request.endMs, request.ids) } catch (_: Throwable) { null }
          if (loaded == null) continue
          val grouped = LinkedHashMap<String, MutableList<NativeEpgProgram>>()
          for (program in loaded) grouped.getOrPut(program.channelId) { ArrayList() }.add(program)
          val frozen = grouped.mapValues { (_, list) -> list.sortedBy { it.startMs }.toTypedArray() }
          post {
            if (disposed || request.token != generation) return@post
            // Stale-while-revalidate paint cache: replace only the rows this
            // query owned, preserve recently painted neighbours for fast reverse
            // navigation, and keep the cache strictly bounded for TV RAM.
            val merged = LinkedHashMap<String, Array<NativeEpgProgram>>()
            for ((id, list) in programs) {
              if (id !in request.ids) merged[id] = list
            }
            for (id in request.ids) {
              val list = frozen[id]
              if (list != null) merged[id] = list
            }
            val cap = if (CharmMemoryCoordinator.budgets().lowRam) LOW_RAM_PAINT_CACHE_CHANNELS else PAINT_CACHE_CHANNELS
            while (merged.size > cap) {
              val oldest = merged.keys.firstOrNull() ?: break
              merged.remove(oldest)
            }
            programs = merged
            invalidate()
            // Data arrival may update the selected programme payload, but only
            // key-up/focus ownership may declare navigation settled. If a drawer,
            // modal, or route owns focus, repaint the cache silently instead of
            // sending a late Guide selection back across the React bridge.
            if (enabled) emitSelection(false)
          }
        }
      } finally {
        queryDrainScheduled.set(false)
        if (!disposed && pendingQuery != null) scheduleQueryDrain()
      }
    }
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(settleSelectionRunnable)
    navigationKeyDown = false
    moveVelocity = 0
    generation += 1
    pendingQuery = null
    super.onDetachedFromWindow()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyPendingRestoreChannel()
    loadPrograms()
  }

  fun dispose() {
    if (disposed) return
    removeCallbacks(settleSelectionRunnable)
    navigationKeyDown = false
    moveVelocity = 0
    disposed = true
    generation += 1
    pendingQuery = null
    programs = emptyMap()
    unregisterMemoryListener()
    io.shutdownNow()
    database.close()
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (!enabled || rows.isEmpty()) return super.onKeyDown(keyCode, event)
    if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
      keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      navigationKeyDown = true
      removeCallbacks(settleSelectionRunnable)
    }
    when (keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> if (selectedRow == 0) emit("upBoundary", null) else moveVertical(-1)
      KeyEvent.KEYCODE_DPAD_DOWN -> moveVertical(1)
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        if (event.repeatCount > 0 && event.eventTime - lastHorizontalMoveAt < 55L) return true
        lastHorizontalMoveAt = event.eventTime
        if (selectedTimeMs <= windowStartMs + 60_000L) {
          emit("topLeftBoundary", null)
          return true
        }
        val current = selectedProgram()
        // A missing painted programme means the newest bounded SQLite runway is
        // still arriving; it is not evidence that the cursor reached Guide Left.
        val nextTime = max(
          windowStartMs,
          current?.let { it.startMs - 1L } ?: (selectedTimeMs - 30L * 60_000L),
        )
        if (nextTime == selectedTimeMs) return true
        selectedTimeMs = nextTime
        ensureSelectedTimeVisible()
        loadPrograms()
        invalidate(); emitSelection(false)
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        if (event.repeatCount > 0 && event.eventTime - lastHorizontalMoveAt < 55L) return true
        lastHorizontalMoveAt = event.eventTime
        val current = selectedProgram()
        val nextTime = min(windowEndMs - 1, current?.endMs ?: selectedTimeMs + 30L * 60_000L)
        if (nextTime == selectedTimeMs) return true
        selectedTimeMs = nextTime
        ensureSelectedTimeVisible()
        // Horizontal cache misses must request the newest runway even when the
        // viewport guard did not move. scheduleQueryDrain coalesces old requests.
        loadPrograms()
        invalidate(); emitSelection(false)
      }
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A -> emitSelection(true, pressed = true)
      else -> return super.onKeyDown(keyCode, event)
    }
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
      keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      navigationKeyDown = false
      moveVelocity = 0
      removeCallbacks(settleSelectionRunnable)
      if (enabled) postDelayed(settleSelectionRunnable, 80L)
      return true
    }
    return super.onKeyUp(keyCode, event)
  }

  private fun moveVertical(delta: Int) {
    val nextRow = (selectedRow + delta).coerceIn(0, rows.lastIndex)
    if (nextRow == selectedRow) return
    val now = SystemClock.uptimeMillis()
    moveVelocity = if (now - lastMoveAt < 150L) min(4, moveVelocity + 1) else 0
    lastMoveAt = now
    selectedRow = nextRow
    ensureVisible()
    loadPrograms()
    invalidate()
    emitSelection(false)
    emitRunway(delta)
  }

  private fun ensureVisible() {
    val visible = max(1, ((height - headerHeight) / rowHeight).toInt())
    if (selectedRow < firstVisibleRow) firstVisibleRow = selectedRow
    if (selectedRow >= firstVisibleRow + visible) firstVisibleRow = selectedRow - visible + 1
    firstVisibleRow = firstVisibleRow.coerceIn(0, max(0, rows.size - visible))
  }

  private fun selectedProgram(): NativeEpgProgram? {
    val id = rows.getOrNull(selectedRow)?.id ?: return null
    val list = programs[id] ?: return null
    var low = 0
    var high = list.size
    while (low < high) { val mid = (low + high) ushr 1; if (list[mid].startMs <= selectedTimeMs) low = mid + 1 else high = mid }
    val candidate = list.getOrNull(max(0, low - 1))
    return if (candidate != null && candidate.endMs > selectedTimeMs) candidate else list.getOrNull(low)
  }

  private fun emitSelection(immediate: Boolean, pressed: Boolean = false) {
    val row = rows.getOrNull(selectedRow) ?: return
    val program = selectedProgram()
    val payload = Arguments.createMap().apply {
      putString("channelId", row.id)
      putInt("row", selectedRow)
      putBoolean("settled", immediate || (!navigationKeyDown && moveVelocity == 0))
      putBoolean("pressed", pressed)
      if (program != null) {
        putMap("program", Arguments.createMap().apply {
          putString("title", program.title); putString("desc", program.description ?: "")
          putString("category", program.category ?: ""); putDouble("startMs", program.startMs.toDouble())
          putDouble("endMs", program.endMs.toDouble())
        })
      }
    }
    emit("selectionChange", payload)
  }

  private fun emitRunway(direction: Int) {
    val visible = max(6, ((height - headerHeight) / rowHeight).toInt())
    val aheadPages = 2 + moveVelocity
    val behind = visible
    val ahead = visible * aheadPages
    val from = max(0, selectedRow - if (direction < 0) ahead else behind)
    val to = min(rows.size, selectedRow + if (direction > 0) ahead else behind + 1)
    val payload = Arguments.createMap().apply {
      putArray("ids", Arguments.fromList(rows.subList(from, to).map { it.id }))
      putArray("priorityIds", Arguments.fromList(rows.subList(selectedRow, min(rows.size, selectedRow + max(3, visible))).map { it.id }))
      putInt("pageSize", visible); putInt("velocity", moveVelocity); putInt("direction", direction)
    }
    emit("runwayChange", payload)
  }

  @Suppress("DEPRECATION")
  private fun emit(name: String, payload: com.facebook.react.bridge.WritableMap?) {
    (context as? ThemedReactContext)?.getJSModule(RCTEventEmitter::class.java)?.receiveEvent(id, name, payload)
  }

  private fun timeToX(timeMs: Long, visibleStartMs: Long, visibleEndMs: Long): Float {
    val guideWidth = max(1f, width.toFloat() - channelWidth)
    val duration = max(1L, visibleEndMs - visibleStartMs)
    return channelWidth + ((timeMs - visibleStartMs).toFloat() / duration.toFloat()) * guideWidth
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), background)
    canvas.drawRect(0f, 0f, width.toFloat(), headerHeight, header)

    val visibleStartMs = viewportStartMs
    val visibleEndMs = viewportEndMs()
    drawHeader(canvas, visibleStartMs, visibleEndMs)

    val visibleRows = max(1, ceil((height - headerHeight) / rowHeight).toInt())
    for (slot in 0 until visibleRows) {
      val rowIndex = firstVisibleRow + slot
      val row = rows.getOrNull(rowIndex) ?: break
      val top = headerHeight + slot * rowHeight
      channel.color = if (rowIndex == selectedRow) Color.rgb(61, 43, 92) else Color.rgb(26, 22, 38)
      canvas.drawRect(0f, top, channelWidth, top + rowHeight - density, channel)
      canvas.drawRect(channelWidth, top, width.toFloat(), top + rowHeight - density, rowSurface)
      drawClippedText(canvas, row.label, pad, top + rowHeight * .62f, channelWidth - pad, title)

      val list = programs[row.id].orEmpty()
      var paintedProgramme = false
      for (program in list) {
        if (program.endMs <= visibleStartMs || program.startMs >= visibleEndMs) continue
        val left = timeToX(program.startMs, visibleStartMs, visibleEndMs)
        val right = timeToX(program.endMs, visibleStartMs, visibleEndMs)
        val clippedLeft = max(channelWidth, left)
        val clippedRight = min(width.toFloat(), right)
        if (clippedRight <= clippedLeft) continue
        paintedProgramme = true
        val chosen = rowIndex == selectedRow && program.startMs <= selectedTimeMs && program.endMs > selectedTimeMs
        canvas.drawRect(
          RectF(clippedLeft + density, top + density, clippedRight - density, top + rowHeight - 2f * density),
          if (chosen) selected else cell,
        )
        drawClippedText(canvas, program.title, clippedLeft + pad, top + rowHeight * .60f, clippedRight - pad, title)
      }
      if (!paintedProgramme) {
        // A legitimate unmatched/empty EPG row must never look like a broken
        // black canvas. Keep the row selectable/playable and show a neutral
        // TiviMate-style placeholder without inventing persisted programme data.
        val left = channelWidth + density
        val right = width.toFloat() - density
        if (right > left) {
          canvas.drawRect(
            RectF(left, top + density, right, top + rowHeight - 2f * density),
            if (rowIndex == selectedRow) selected else cell,
          )
          drawClippedText(canvas, "No information", left + pad, top + rowHeight * .60f, right - pad, muted)
        }
      }
      canvas.drawLine(0f, top + rowHeight, width.toFloat(), top + rowHeight, divider)
    }

    val now = System.currentTimeMillis()
    if (now in visibleStartMs..visibleEndMs) {
      val x = timeToX(now, visibleStartMs, visibleEndMs)
      canvas.drawLine(x, headerHeight, x, height.toFloat(), nowPaint)
    }
  }

  private fun drawHeader(canvas: Canvas, start: Long, end: Long) {
    canvas.drawText("CHANNEL", pad, headerHeight * .66f, muted)
    var tick = ((start / 1_800_000L) + 1) * 1_800_000L
    while (tick < end) {
      val x = timeToX(tick, start, end)
      tickDate.time = tick
      val timeLabel = timeFormatter.format(tickDate)
      canvas.drawText(timeLabel, x + pad, headerHeight * .66f, muted)
      canvas.drawLine(x, headerHeight, x, height.toFloat(), divider)
      tick += 1_800_000L
    }
  }

  private fun drawClippedText(canvas: Canvas, value: String, x: Float, baseline: Float, right: Float, paint: Paint) {
    if (right <= x) return
    canvas.save(); canvas.clipRect(x, baseline - rowHeight, right, baseline + pad)
    canvas.drawText(value, x, baseline, paint); canvas.restore()
  }

  companion object {
    private const val PAINT_CACHE_CHANNELS = 128
    private const val LOW_RAM_PAINT_CACHE_CHANNELS = 64
  }
}
