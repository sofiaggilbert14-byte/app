package com.charmiptv.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.KeyEvent
import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * One focusable Android view owns the entire guide. D-pad navigation changes a
 * logical cursor synchronously on the UI thread; it never waits for React rows
 * or programme cells to mount. EPG reads happen ahead of the visible runway.
 */
class NativeGuideView(context: Context) : View(context) {
  data class ChannelRow(val id: String, val name: String, val number: String)

  private val database = EpgDatabase(context)
  private val queryExecutor = Executors.newSingleThreadExecutor()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
  private var rows: List<ChannelRow> = emptyList()
  private var programs: Map<String, List<NativeEpgProgram>> = emptyMap()
  private var selectedRow = 0
  private var selectedProgram = 0
  private var firstVisibleRow = 0
  private var windowStartMs = System.currentTimeMillis() - 30 * 60_000L
  private var windowEndMs = System.currentTimeMillis() + 3 * 60 * 60_000L
  private var active = true
  private var lastDirection = 0
  private var repeatCount = 0
  private var generation = 0
  private val rowHeight = 74f
  private val channelWidth = 250f
  private val headerHeight = 42f

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    setBackgroundColor(Color.rgb(8, 8, 18))
  }

  fun setRows(value: List<ChannelRow>) {
    rows = value
    selectedRow = selectedRow.coerceIn(0, max(0, rows.lastIndex))
    firstVisibleRow = firstVisibleRow.coerceIn(0, max(0, rows.lastIndex))
    prefetch()
    invalidate()
  }

  fun setWindow(start: Double, end: Double) {
    windowStartMs = start.toLong()
    windowEndMs = end.toLong()
    prefetch()
  }

  fun setWindowStart(start: Double) = setWindow(start, windowEndMs.toDouble())
  fun setWindowEnd(end: Double) = setWindow(windowStartMs.toDouble(), end)

  fun setActive(value: Boolean) {
    active = value
    if (value) post { requestFocus() }
  }

  override fun onDetachedFromWindow() {
    generation += 1
    queryExecutor.shutdownNow()
    super.onDetachedFromWindow()
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (!active || rows.isEmpty()) return super.onKeyDown(keyCode, event)
    val direction = when (keyCode) {
      KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> -1
      KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> 1
      else -> 0
    }
    if (direction != 0) {
      repeatCount = if (lastDirection == direction && event.repeatCount > 0) repeatCount + 1 else 0
      lastDirection = direction
      // Velocity-aware logical movement. The controller can advance several
      // rows per repeat while the canvas performs one draw.
      val step = if (repeatCount > 10) 3 else if (repeatCount > 4) 2 else 1
      selectedRow = (selectedRow + direction * step).coerceIn(0, rows.lastIndex)
      selectedProgram = 0
      keepCursorVisible()
      prefetch()
      emitSelection(settled = false)
      invalidate()
      return true
    }
    when (keyCode) {
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        selectedProgram = max(0, selectedProgram - 1)
        emitSelection(false); invalidate(); return true
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        selectedProgram = min(max(0, selectedPrograms().lastIndex), selectedProgram + 1)
        emitSelection(false); invalidate(); return true
      }
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
        emit("topNativeGuideActivate", selectionPayload(true)); return true
      }
      KeyEvent.KEYCODE_BACK -> {
        emit("topNativeGuideBoundary", Arguments.createMap().apply { putString("edge", "back") })
        return true
      }
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode in listOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_CHANNEL_DOWN)) {
      repeatCount = 0
      postDelayed({ emitSelection(settled = true) }, 90L)
      return true
    }
    return super.onKeyUp(keyCode, event)
  }

  private fun selectedPrograms(): List<NativeEpgProgram> =
    rows.getOrNull(selectedRow)?.let { programs[it.id] }.orEmpty()

  private fun keepCursorVisible() {
    val visible = max(1, ((height - headerHeight) / rowHeight).toInt())
    if (selectedRow < firstVisibleRow) firstVisibleRow = selectedRow
    if (selectedRow >= firstVisibleRow + visible) firstVisibleRow = selectedRow - visible + 1
  }

  private fun prefetch() {
    if (rows.isEmpty() || queryExecutor.isShutdown) return
    val visible = max(6, ((height - headerHeight) / rowHeight).toInt())
    val ahead = 8 + min(28, repeatCount * 2)
    val from = max(0, firstVisibleRow - ahead)
    val to = min(rows.size, firstVisibleRow + visible + ahead)
    val ids = rows.subList(from, to).map { it.id }
    val requestGeneration = ++generation
    queryExecutor.execute {
      try {
        val loaded = database.queryGuideWindow(windowStartMs, windowEndMs, ids).groupBy { it.channelId }
        post {
          if (requestGeneration != generation) return@post
          programs = programs.toMutableMap().apply { putAll(loaded) }
          selectedProgram = selectedProgram.coerceIn(0, max(0, selectedPrograms().lastIndex))
          emitSelection(false)
          invalidate()
        }
      } catch (_: Throwable) { /* preserve last-good canvas */ }
    }
  }

  private fun selectionPayload(settled: Boolean) = Arguments.createMap().apply {
    val channel = rows.getOrNull(selectedRow)
    val program = selectedPrograms().getOrNull(selectedProgram)
    putString("channelId", channel?.id)
    putString("channelName", channel?.name)
    putInt("rowIndex", selectedRow)
    putBoolean("settled", settled)
    if (program != null) {
      putString("title", program.title)
      putString("description", program.description)
      putString("category", program.category)
      putDouble("startMs", program.startMs.toDouble())
      putDouble("stopMs", program.endMs.toDouble())
    }
  }

  private fun emitSelection(settled: Boolean) = emit("topNativeGuideSelection", selectionPayload(settled))

  @Suppress("DEPRECATION")
  private fun emit(name: String, payload: com.facebook.react.bridge.WritableMap) {
    (context as? ReactContext)?.getJSModule(RCTEventEmitter::class.java)?.receiveEvent(id, name, payload)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val visible = max(1, ((height - headerHeight) / rowHeight).toInt() + 1)
    paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
    paint.textSize = 17f
    paint.color = Color.LTGRAY
    canvas.drawText(timeFormat.format(Date(windowStartMs)), channelWidth + 14f, 28f, paint)
    val duration = max(1L, windowEndMs - windowStartMs)
    for (screenRow in 0 until visible) {
      val index = firstVisibleRow + screenRow
      val row = rows.getOrNull(index) ?: break
      val top = headerHeight + screenRow * rowHeight
      paint.color = if (index == selectedRow) Color.rgb(35, 27, 62) else Color.rgb(17, 17, 31)
      canvas.drawRect(0f, top, width.toFloat(), top + rowHeight - 2f, paint)
      paint.color = Color.WHITE
      paint.textSize = 17f
      canvas.drawText("${row.number}  ${row.name}".take(30), 16f, top + 43f, paint)
      val list = programs[row.id].orEmpty()
      list.forEachIndexed { programIndex, program ->
        val left = channelWidth + ((program.startMs - windowStartMs).toFloat() / duration) * (width - channelWidth)
        val right = channelWidth + ((program.endMs - windowStartMs).toFloat() / duration) * (width - channelWidth)
        if (right <= channelWidth || left >= width) return@forEachIndexed
        val selected = index == selectedRow && programIndex == selectedProgram
        paint.color = if (selected) Color.rgb(139, 92, 246) else Color.rgb(38, 38, 57)
        canvas.drawRoundRect(RectF(max(channelWidth, left) + 2f, top + 5f, min(width.toFloat(), right) - 2f, top + rowHeight - 7f), 6f, 6f, paint)
        paint.color = Color.WHITE
        paint.textSize = if (selected) 16f else 14f
        canvas.save()
        canvas.clipRect(max(channelWidth, left) + 8f, top, min(width.toFloat(), right) - 5f, top + rowHeight)
        canvas.drawText(program.title, max(channelWidth, left) + 9f, top + 39f, paint)
        canvas.restore()
      }
    }
  }
}
