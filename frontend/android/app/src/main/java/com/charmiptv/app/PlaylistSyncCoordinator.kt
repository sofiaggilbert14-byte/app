package com.charmiptv.app

import android.database.sqlite.SQLiteDatabase

/**
 * Clean-room playlist sync modeled on the behavior documented in the TiViMate
 * reference analysis: validate first, update provider-owned fields in place,
 * insert new rows, soft-delete missing rows, and commit atomically.
 *
 * User-owned state is intentionally not stored in this table; favorites,
 * custom order/numbers/groups and manual EPG bindings live in their dedicated
 * stores and are therefore never rewritten by a provider playlist refresh.
 */
internal object PlaylistSyncCoordinator {
  private const val PLAYLIST_TABLE = "playlist_channels"
  private const val META_TABLE = "epg_meta"
  private const val FINGERPRINT_KEY = "playlist_content_fingerprint"

  fun sync(
    database: EpgDatabase,
    rows: List<PlaylistChannelRow>,
    playlistEpoch: Long,
    contentFingerprint: String,
  ): Boolean {
    // TiViMate-style last-good rule: a failed/empty provider parse must not wipe
    // the existing channel catalog.
    if (rows.isEmpty()) {
      throw IllegalStateException("Refusing to replace live playlist with an empty feed")
    }

    val db = database.writableDatabase
    val fingerprint = contentFingerprint.trim()
    if (fingerprint.isNotEmpty() && readMeta(db, FINGERPRINT_KEY) == fingerprint) return false

    val now = System.currentTimeMillis()
    db.beginTransaction()
    try {
      // Mark current provider rows missing until proven present by this import.
      // Existing row identities remain intact so related user state can survive
      // provider disappearance/reappearance without destructive table rebuilds.
      db.execSQL("UPDATE $PLAYLIST_TABLE SET deleted_at = ? WHERE deleted_at = 0", arrayOf(now))

      val update = db.compileStatement(
        """
        UPDATE $PLAYLIST_TABLE
        SET raw_tvg_id = ?, name = ?, logo = ?, group_title = ?,
            norm_id = ?, norm_name = ?, updated_at = ?, deleted_at = 0
        WHERE playlist_id = ?
        """.trimIndent()
      )
      val insert = db.compileStatement(
        """
        INSERT INTO $PLAYLIST_TABLE(
          playlist_id, raw_tvg_id, name, logo, group_title,
          norm_id, norm_name, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        """.trimIndent()
      )
      try {
        for (row in rows) {
          if (row.playlistId.isBlank()) continue
          val rawTvg = row.rawTvgId.trim()
          val normSource = if (rawTvg.isNotEmpty()) rawTvg else row.playlistId
          val normId = EpgDatabase.normalizeKey(normSource)
          val normName = EpgDatabase.normalizeKey(row.name)

          update.clearBindings()
          update.bindString(1, rawTvg)
          update.bindString(2, row.name)
          update.bindString(3, row.logo)
          update.bindString(4, row.groupTitle)
          update.bindString(5, normId)
          update.bindString(6, normName)
          update.bindLong(7, now)
          update.bindString(8, row.playlistId)
          val changed = update.executeUpdateDelete()
          if (changed > 0) continue

          insert.clearBindings()
          insert.bindString(1, row.playlistId)
          insert.bindString(2, rawTvg)
          insert.bindString(3, row.name)
          insert.bindString(4, row.logo)
          insert.bindString(5, row.groupTitle)
          insert.bindString(6, normId)
          insert.bindString(7, normName)
          insert.bindLong(8, now)
          insert.executeInsert()
        }
      } finally {
        update.close()
        insert.close()
      }

      writeMeta(db, "playlist_epoch", playlistEpoch.toString())
      if (fingerprint.isNotEmpty()) writeMeta(db, FINGERPRINT_KEY, fingerprint)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return true
  }

  private fun readMeta(db: SQLiteDatabase, key: String): String? {
    db.rawQuery("SELECT value FROM $META_TABLE WHERE key = ? LIMIT 1", arrayOf(key)).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getString(0) else null
    }
  }

  private fun writeMeta(db: SQLiteDatabase, key: String, value: String) {
    db.execSQL(
      "INSERT OR REPLACE INTO $META_TABLE(key, value) VALUES (?, ?)",
      arrayOf(key, value),
    )
  }
}
