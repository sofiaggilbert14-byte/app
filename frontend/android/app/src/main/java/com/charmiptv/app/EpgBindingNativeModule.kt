package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import java.util.concurrent.Executors

/**
 * Small bridge around the authoritative epg_channel_bindings table.
 * JS may keep a session snapshot for rendering, but Room is the only Android
 * durable source of manual XMLTV ownership after legacy migration.
 */
class EpgBindingNativeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val dao = EpgControlDatabase.get(reactContext).dao()
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "CharmEpgBindings"

  @ReactMethod
  fun getBindings(promise: Promise) {
    executor.execute {
      try {
        val result = Arguments.createMap()
        for (row in dao.allChannelBindings(USER_SOURCE_ID)) {
          if (row.channelId.isNotBlank() && row.xmltvId.isNotBlank()) {
            result.putString(row.channelId, row.xmltvId)
          }
        }
        promise.resolve(result)
      } catch (t: Throwable) {
        promise.reject("EPG_BINDINGS_READ_FAILED", t.message ?: "Could not read Guide assignments", t)
      }
    }
  }

  @ReactMethod
  fun importLegacyIfEmpty(overrides: ReadableMap, promise: Promise) {
    executor.execute {
      try {
        if (dao.channelBindingCount(USER_SOURCE_ID) > 0) {
          promise.resolve(false)
          return@execute
        }
        val rows = ArrayList<EpgChannelBindingEntity>()
        val iterator = overrides.keySetIterator()
        val seen = HashSet<String>()
        while (iterator.hasNextKey() && rows.size < MAX_BINDINGS) {
          val rawChannelId = iterator.nextKey()
          if (overrides.getType(rawChannelId) != ReadableType.String) continue
          val channelId = rawChannelId.trim().take(MAX_ID_LENGTH)
          val xmltvId = overrides.getString(rawChannelId)?.trim().orEmpty().take(MAX_ID_LENGTH)
          if (channelId.isEmpty() || xmltvId.isEmpty() || !seen.add(channelId)) continue
          if (channelId.contains("://") || xmltvId.contains("://")) continue
          rows.add(EpgChannelBindingEntity(USER_SOURCE_ID, channelId, xmltvId))
        }
        if (rows.isNotEmpty()) dao.replaceChannelBindings(USER_SOURCE_ID, rows)
        promise.resolve(rows.isNotEmpty())
      } catch (t: Throwable) {
        promise.reject("EPG_BINDINGS_MIGRATION_FAILED", t.message ?: "Could not migrate Guide assignments", t)
      }
    }
  }

  @ReactMethod
  fun clearBindings(promise: Promise) {
    executor.execute {
      try {
        dao.clearChannelBindings(USER_SOURCE_ID)
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_BINDINGS_CLEAR_FAILED", t.message ?: "Could not clear Guide assignments", t)
      }
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  companion object {
    private const val USER_SOURCE_ID = "user"
    private const val MAX_BINDINGS = 10_000
    private const val MAX_ID_LENGTH = 180
  }
}
