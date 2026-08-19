package com.charmiptv.app

import android.content.Context
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Process-local handles for independently transactional custom XMLTV stores. */
internal object CustomEpgStoreRegistry {
  // Stable last-good migration name: charm_epg_user_v1.db
  private const val LEGACY_SOURCE_ID = "user"
  private val stores = ConcurrentHashMap<String, EpgDatabase>()

  fun normalizeSourceId(raw: String): String {
    val clean = raw.trim().lowercase().replace(Regex("[^a-z0-9_-]"), "").take(48)
    require(clean.isNotEmpty()) { "Custom EPG source id is empty" }
    return if (clean == LEGACY_SOURCE_ID || clean.startsWith("user:")) clean else "user:$clean"
  }

  fun database(context: Context, rawSourceId: String): EpgDatabase {
    val sourceId = normalizeSourceId(rawSourceId)
    return stores.getOrPut(sourceId) {
      val name = if (sourceId == LEGACY_SOURCE_ID) "charm_epg_user_v1.db" else {
        val digest = MessageDigest.getInstance("SHA-256").digest(sourceId.toByteArray())
          .take(12).joinToString("") { "%02x".format(it) }
        "charm_epg_user_${digest}.db"
      }
      EpgDatabase(context.applicationContext, name)
    }
  }

  fun closeAll() {
    stores.values.forEach { try { it.close() } catch (_: Throwable) {} }
    stores.clear()
  }
}
