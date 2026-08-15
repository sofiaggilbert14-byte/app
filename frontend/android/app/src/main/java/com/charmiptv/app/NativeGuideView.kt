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
import java.util.concurrent.Executors
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Constant-view-count TV guide. Selection is coordinates, never Android focus nodes.
 * SQLite is read only when the channel/time runway changes; draw and key-repeat paths
 * operate exclusively on sorted native memory.
 */
class NativeGuideView(context: Context) : View(context) {
  private data class ChannelRow(val id: String, val name: String, val number: String)

  private val database = EpgDatabase(context.applicationContext)
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "CharmGuideRead").apply { isDaemon = true } }
  private val rows = ArrayList<ChannelRow>()
  @Volatile private var programs = emptyMap<String, Array<NativeEpgProgram>>()
  private var windowStartMs = System.currentTimeMillis() - 30L * 60_000L
  private var windowEndMs = windowStartMs + 3L * 60L * 60_000L
  private var selectedRow = 0
  private var selectedTimeMs = System.currentTimeMillis()
  private var firstVisibleRow = 0
  private var generation = 0
  private var enabled = true
  private var lastMoveAt = 0L
  private var moveVelocity = 0
  private val density = resources.displayMetrics.density
  private val channelWidth = 184f * density
  private val headerHeight = 34f * density
  private val rowHeight = 48f * density
  private val pad = 8f * density
  private val pixelsPerMinute = 2.0f * density
  private val background = Paint().apply { color = Color.rgb(8, 7, 13) }
  private val header = Paint().apply { color = Color.rgb(22, 18, 33) }
  private val channel = Paint().apply { color = Color.rgb(26, 22, 38) }
  private val cell = Paint().apply { color = Color.rgb(31, 27, 45) }
  private val selected = Paint().apply { color = Color.rgb(119, 74, 219) }
  private val divider = Paint().apply { color = Color.rgb(53, 45, 72); strokeWidth = density }
  private val nowPaint = Paint().apply { color = Color.rgb(197, 158, 255); strokeWidth = 2f * density }
  private val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 13f * density }
  private val muted = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(183, 174, 204); textSize = 11f * density }

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    setBackgroundColor(Color.BLACK)
  }

  fun setChannels(value: ReadableArray?) {
    val restoreId = rows.getOrNull(selectedRow)?.id
    rows.clear()
    if (value != null) for (index in 0 until value.size()) {
      val item = value.getMap(index) ?: continue
      val id = item.getString("id") ?: continue
      rows.add(ChannelRow(id, item.getString("name") ?: "Channel", item.getString("number") ?: ""))
    }
    selectedRow = max(0, restoreId?.let { wanted -> rows.indexOfFirst { it.id == wanted } } ?: 0)
    if (selectedRow >= rows.size) selectedRow = max(0, rows.lastIndex)
    ensureVisible()
    loadPrograms()
    invalidate()
  }

  fun setWindow(start: Double, end: Double) {
    val nextStart = start.toLong()
    val nextEnd = end.toLong()
    if (nextEnd <= nextStart || (nextStart == windowStartMs && nextEnd == windowEndMs)) return
    windowStartMs = nextStart
    windowEndMs = nextEnd
    selectedTimeMs = selectedTimeMs.coerceIn(windowStartMs, windowEndMs - 1)
    loadPrograms()
  }

  fun setActive(value: Boolean) {
    enabled = value
    if (value) { requestFocus(); emitSelection(true) }
  }

  fun restoreChannel(channelId: String?) {
    if (channelId.isNullOrBlank()) return
    val index = rows.indexOfFirst { it.id == channelId }
    if (index >= 0) { selectedRow = index; ensureVisible(); invalidate(); emitSelection(true) }
  }

  private fun loadPrograms() {
    val ids = rows.map { it.id }
    if (ids.isEmpty()) { programs = emptyMap(); return }
    val token = ++generation
    io.execute {
      val loaded = try { database.queryGuideWindow(windowStartMs, windowEndMs, ids) } catch (_: Throwable) { emptyList() }
      val grouped = LinkedHashMap<String, MutableList<NativeEpgProgram>>()
      for (program in loaded) grouped.getOrPut(program.channelId) { ArrayList() }.add(program)
      val frozen = grouped.mapValues { it.value.toTypedArray() }
      post {
        if (token != generation) return@post
        programs = frozen
        invalidate()
        emitSelection(true)
      }
    }
  }

  override fun onDetachedFromWindow() {
    generation += 1
    io.shutdownNow()
    database.close()
    super.onDetachedFromWindow()
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (!enabled || rows.isEmpty()) return super.onKeyDown(keyCode, event)
    when (keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> if (selectedRow == 0) emit("upBoundary", null) else moveVertical(-1)
      KeyEvent.KEYCODE_DPAD_DOWN -> moveVertical(1)
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        val current = selectedProgram()
        if (current == null || selectedTimeMs <= windowStartMs + 60_000L) { emit("topLeftBoundary", null); return true }
        selectedTimeMs = max(windowStartMs, current.startMs - 1)
        invalidate(); emitSelection(false)
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        val current = selectedProgram()
        selectedTimeMs = min(windowEndMs - 1, current?.endMs ?: selectedTimeMs + 30L * 60_000L)
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
      moveVelocity = 0
      postDelayed({ emitSelection(true) }, 80L)
      return true
    }
    return super.onKeyUp(keyCode, event)
  }

  private fun moveVertical(delta: Int) {
    val now = SystemClock.uptimeMillis()
    moveVelocity = if (now - lastMoveAt < 150L) min(4, moveVelocity + 1) else 0
    lastMoveAt = now
    selectedRow = (selectedRow + delta).coerceIn(0, rows.lastIndex)
    ensureVisible()
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
      putBoolean("settled", immediate || moveVelocity == 0)
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

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), background)
    canvas.drawRect(0f, 0f, width.toFloat(), headerHeight, header)
    val visibleStartMs = selectedTimeMs - 15L * 60_000L
    val visibleEndMs = visibleStartMs + (((width - channelWidth) / pixelsPerMinute) * 60_000L).toLong()
    drawHeader(canvas, visibleStartMs, visibleEndMs)
    val visibleRows = max(1, ceil((height - headerHeight) / rowHeight).toInt())
    for (slot in 0 until visibleRows) {
      val rowIndex = firstVisibleRow + slot
      val row = rows.getOrNull(rowIndex) ?: break
      val top = headerHeight + slot * rowHeight
      channel.color = if (rowIndex == selectedRow) Color.rgb(61, 43, 92) else Color.rgb(26, 22, 38)
      canvas.drawRect(0f, top, channelWidth, top + rowHeight - density, channel)
      drawClippedText(canvas, listOfNotNull(row.number.takeIf { it.isNotBlank() }, row.name).joinToString("  "), pad, top + rowHeight * .62f, channelWidth - pad, title)
      val list = programs[row.id].orEmpty()
      for (program in list) {
        if (program.endMs <= visibleStartMs || program.startMs >= visibleEndMs) continue
        val left = channelWidth + ((program.startMs - visibleStartMs) / 60_000f) * pixelsPerMinute
        val right = channelWidth + ((program.endMs - visibleStartMs) / 60_000f) * pixelsPerMinute
        val chosen = rowIndex == selectedRow && program.startMs <= selectedTimeMs && program.endMs > selectedTimeMs
        canvas.drawRect(RectF(max(channelWidth, left) + density, top + density, min(width.toFloat(), right) - density, top + rowHeight - 2f * density), if (chosen) selected else cell)
        drawClippedText(canvas, program.title, max(channelWidth, left) + pad, top + rowHeight * .60f, min(width.toFloat(), right) - pad, title)
      }
      canvas.drawLine(0f, top + rowHeight, width.toFloat(), top + rowHeight, divider)
    }
    val now = System.currentTimeMillis()
    if (now in visibleStartMs..visibleEndMs) {
      val x = channelWidth + ((now - visibleStartMs) / 60_000f) * pixelsPerMinute
      canvas.drawLine(x, headerHeight, x, height.toFloat(), nowPaint)
    }
  }

  private fun drawHeader(canvas: Canvas, start: Long, end: Long) {
    canvas.drawText("CHANNEL", pad, headerHeight * .66f, muted)
    var tick = ((start / 1_800_000L) + 1) * 1_800_000L
    while (tick < end) {
      val x = channelWidth + ((tick - start) / 60_000f) * pixelsPerMinute
      val date = java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault()).format(java.util.Date(tick))
      canvas.drawText(date, x + pad, headerHeight * .66f, muted)
      canvas.drawLine(x, headerHeight, x, height.toFloat(), divider)
      tick += 1_800_000L
    }
  }

  private fun drawClippedText(canvas: Canvas, value: String, x: Float, baseline: Float, right: Float, paint: Paint) {
    if (right <= x) return
    canvas.save(); canvas.clipRect(x, baseline - rowHeight, right, baseline + pad)
    canvas.drawText(value, x, baseline, paint); canvas.restore()
  }
}
