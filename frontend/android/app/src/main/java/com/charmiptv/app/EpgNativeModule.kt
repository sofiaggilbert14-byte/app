package com.charmiptv.app

import android.util.Xml
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

class EpgNativeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val database = EpgDatabase(reactContext)
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "CharmEpg"

  @ReactMethod
  fun refresh(url: String, promise: Promise) {
    executor.execute {
      try {
        val now = System.currentTimeMillis()
        val minStop = now - 6L * 60L * 60L * 1000L
        val maxStart = now + GUIDE_WINDOW_MS
        val batches = streamProgramBatches(url, minStop, maxStart)
        database.replaceBatches(batches)
        val result = Arguments.createMap().apply {
          putDouble("count", database.count().toDouble())
          putDouble("windowStartMs", now.toDouble())
          putDouble("windowEndMs", maxStart.toDouble())
        }
        promise.resolve(result)
      } catch (t: Throwable) {
        promise.reject("EPG_REFRESH_FAILED", t.message ?: "Native EPG refresh failed", t)
      }
    }
  }

  @ReactMethod
  fun getWindow(startMs: Double, endMs: Double, promise: Promise) {
    executor.execute {
      try {
        val programmes = database.queryWindow(startMs.toLong(), endMs.toLong())
        val grouped = Arguments.createMap()
        for (program in programmes) {
          val array = grouped.getArray(program.channelId) ?: Arguments.createArray()
          array.pushMap(programToMap(program))
          grouped.putArray(program.channelId, array)
        }
        promise.resolve(grouped)
      } catch (t: Throwable) {
        promise.reject("EPG_WINDOW_FAILED", t.message ?: "Could not read native EPG window", t)
      }
    }
  }

  @ReactMethod
  fun getCurrent(promise: Promise) {
    executor.execute {
      try {
        val programmes = database.queryCurrent(System.currentTimeMillis())
        val result = Arguments.createMap()
        for (program in programmes) {
          result.putMap(program.channelId, programToMap(program))
        }
        promise.resolve(result)
      } catch (t: Throwable) {
        promise.reject("EPG_CURRENT_FAILED", t.message ?: "Could not read current EPG", t)
      }
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    executor.execute {
      try {
        database.writableDatabase.delete("epg_programmes", null, null)
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_CLEAR_FAILED", t.message ?: "Could not clear native EPG cache", t)
      }
    }
  }

  private fun programToMap(program: NativeEpgProgram) = Arguments.createMap().apply {
    putString("channelId", program.channelId)
    putString("title", program.title)
    if (program.description != null) putString("description", program.description)
    else putNull("description")
    putDouble("startMs", program.startMs.toDouble())
    putDouble("endMs", program.endMs.toDouble())
  }

  private fun streamProgramBatches(
    url: String,
    minStop: Long,
    maxStart: Long,
  ): Sequence<List<NativeEpgProgram>> = sequence {
    openPossiblyGzipped(url).use { input ->
      val parser = Xml.newPullParser()
      parser.setInput(input, "UTF-8")

      val batch = ArrayList<NativeEpgProgram>(BATCH_SIZE)
      var event = parser.eventType
      var channelId: String? = null
      var startMs = 0L
      var endMs = 0L
      var title = ""
      var description: String? = null

      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> when (parser.name) {
            "programme" -> {
              channelId = parser.getAttributeValue(null, "channel")
              startMs = parseXmltvTime(parser.getAttributeValue(null, "start"))
              endMs = parseXmltvTime(parser.getAttributeValue(null, "stop"))
              title = ""
              description = null
            }
            "title" -> if (channelId != null) title = parser.nextText().trim()
            "desc" -> if (channelId != null) description = parser.nextText().trim().ifEmpty { null }
          }
          XmlPullParser.END_TAG -> if (parser.name == "programme") {
            val id = channelId
            if (
              !id.isNullOrBlank() &&
              startMs > 0L &&
              endMs > startMs &&
              endMs >= minStop &&
              startMs <= maxStart
            ) {
              batch.add(
                NativeEpgProgram(
                  channelId = id,
                  title = title.ifBlank { "No Information" },
                  description = description,
                  startMs = startMs,
                  endMs = endMs,
                )
              )
              if (batch.size >= BATCH_SIZE) {
                yield(ArrayList(batch))
                batch.clear()
              }
            }
            channelId = null
          }
        }
        event = parser.next()
      }
      if (batch.isNotEmpty()) yield(ArrayList(batch))
    }
  }

  private fun openPossiblyGzipped(urlString: String): InputStream {
    val connection = URL(urlString).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 45_000
    connection.instanceFollowRedirects = true
    connection.setRequestProperty("User-Agent", "CharmIPTV/Experimental-v3")
    connection.connect()
    if (connection.responseCode !in 200..299) {
      connection.disconnect()
      throw IllegalStateException("EPG HTTP ${connection.responseCode}")
    }

    val buffered = BufferedInputStream(connection.inputStream, 64 * 1024)
    buffered.mark(2)
    val b1 = buffered.read()
    val b2 = buffered.read()
    buffered.reset()

    return if (b1 == 0x1f && b2 == 0x8b) {
      GZIPInputStream(buffered, 64 * 1024)
    } else {
      buffered
    }
  }

  private fun parseXmltvTime(raw: String?): Long {
    if (raw == null) return 0L
    val value = raw.trim()
    if (value.length < 14) return 0L
    return try {
      val year = value.substring(0, 4).toInt()
      val month = value.substring(4, 6).toInt()
      val day = value.substring(6, 8).toInt()
      val hour = value.substring(8, 10).toInt()
      val minute = value.substring(10, 12).toInt()
      val second = value.substring(12, 14).toInt()
      val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        clear()
        set(year, month - 1, day, hour, minute, second)
      }
      var millis = calendar.timeInMillis
      val rest = value.substring(14).trim()
      if (rest.length >= 5 && (rest[0] == '+' || rest[0] == '-')) {
        val sign = if (rest[0] == '-') -1 else 1
        val offsetHours = rest.substring(1, 3).toInt()
        val offsetMinutes = rest.substring(3, 5).toInt()
        millis -= sign * (offsetHours * 60L + offsetMinutes) * 60_000L
      }
      millis
    } catch (_: Throwable) {
      0L
    }
  }

  companion object {
    private const val BATCH_SIZE = 1000
    private const val GUIDE_WINDOW_MS = 24L * 60L * 60L * 1000L
  }
}
