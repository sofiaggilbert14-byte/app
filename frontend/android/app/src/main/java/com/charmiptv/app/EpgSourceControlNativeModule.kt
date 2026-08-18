package com.charmiptv.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

/**
 * Scalar Guide-source configuration only. Manual channel ownership lives in
 * epg_channel_bindings and is deliberately never replaced from JS here.
 */
class EpgSourceControlNativeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val dao = EpgControlDatabase.get(reactContext).dao()
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "CharmEpgSourceControl"

  @ReactMethod
  fun configureOwnership(
    primaryEnabled: Boolean,
    userEnabled: Boolean,
    userUrl: String,
    promise: Promise,
  ) {
    executor.execute {
      try {
        val now = System.currentTimeMillis() / 1000L
        val primary = dao.source(DEFAULT_SOURCE_ID)
        dao.putSource(
          EpgSourceEntity(
            playlistId = DEFAULT_SOURCE_ID,
            url = primary?.url.orEmpty(),
            enabled = primaryEnabled,
            refreshHours = primary?.refreshHours ?: 12,
            serverOffsetMinutes = primary?.serverOffsetMinutes ?: 0,
            playlistOffsetMinutes = primary?.playlistOffsetMinutes ?: 0,
            updatedAtSeconds = now,
          )
        )

        val normalizedUrl = userUrl.trim()
        val previousUser = dao.source(USER_SOURCE_ID)
        dao.putSource(
          EpgSourceEntity(
            playlistId = USER_SOURCE_ID,
            url = normalizedUrl,
            enabled = userEnabled && normalizedUrl.isNotEmpty(),
            refreshHours = previousUser?.refreshHours ?: 12,
            serverOffsetMinutes = previousUser?.serverOffsetMinutes ?: 0,
            playlistOffsetMinutes = previousUser?.playlistOffsetMinutes ?: 0,
            updatedAtSeconds = now,
          )
        )
        promise.resolve(dao.channelBindingCount(USER_SOURCE_ID))
      } catch (t: Throwable) {
        promise.reject("EPG_SOURCE_OWNERSHIP_FAILED", t.message ?: "Could not save Guide source settings", t)
      }
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  companion object {
    private const val DEFAULT_SOURCE_ID = "default"
    private const val USER_SOURCE_ID = "user"
  }
}
