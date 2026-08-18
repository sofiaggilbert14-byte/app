package com.charmiptv.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.StatFs
import java.security.MessageDigest
import kotlin.math.max

internal data class NativeEpgProgram(
  val channelId: String,
  val title: String,
  val description: String?,
  val category: String?,
  val startMs: Long,
  val endMs: Long,
)

internal data class PlaylistChannelRow(
  val playlistId: String,
  val rawTvgId: String,
  val name: String,
  val logo: String,
  val groupTitle: String,
  val streamUrl: String,
  val streamType: String,
  val providerPosition: Int,
)

internal data class PlaylistEpgMatchRow(
  val playlistId: String,
  val xmltvId: String,
  val logoXmltvId: String,
  val ambiguous: Boolean,
  val matchPolicy: String,
  val manual: Boolean,
)

internal data class EpgAliasRow(val channelId: String, val displayName: String)
internal data class EpgAliasPage(val total: Int, val rows: List<EpgAliasRow>)

/**
 * Native EPG store for Fire TV.
 *
 * Design constraints (do not regress):
 * - Independent last-good LIVE table (never couple playlist wipe to EPG wipe)
 * - Additive schema migrations (never DROP on upgrade)
 * - Staging → atomic LIVE swap; refuse empty replace
 * - Rare idle vacuum only (never on every refresh / surf)
 */
internal class EpgDatabase(context: Context, private val databaseName: String = "charm_epg_v3.db") :
  SQLiteOpenHelper(context, databaseName, null, DATABASE_VERSION) {

  private val appContext = context.applicationContext

  /**
   * Staging + live + WAL can temporarily exceed the final DB size. Refuse the
   * refresh before writing when Android cannot keep the last-good table safe.
   */
  fun assertRefreshStorageAvailable(declaredCompressedBytes: Long = -1L) {
    val dbFile = appContext.getDatabasePath(databaseName)
    val currentBytes = listOf(
      dbFile,
      java.io.File(dbFile.path + "-wal"),
      java.io.File(dbFile.path + "-shm"),
    ).sumOf { if (it.exists()) it.length() else 0L }
    val reserve = 32L * 1024L * 1024L
    val fromCurrent = currentBytes * 2L + reserve
    val fromDownload = if (declaredCompressedBytes > 0L) {
      declaredCompressedBytes * 6L + reserve
    } else 0L
    val required = max(64L * 1024L * 1024L, max(fromCurrent, fromDownload))
    val available = StatFs(appContext.filesDir.absolutePath).availableBytes
    if (available < required) {
      throw IllegalStateException(
        "Not enough storage to update Guide (need about ${required / (1024L * 1024L)} MiB free)"
      )
    }
  }

  override fun onConfigure(db: SQLiteDatabase) {
    super.onConfigure(db)
    db.setForeignKeyConstraintsEnabled(false)
    db.rawQuery("PRAGMA journal_mode=WAL", null).close()
    db.execSQL("PRAGMA synchronous=NORMAL")
    db.execSQL("PRAGMA busy_timeout=3000")
    db.execSQL("PRAGMA temp_store=MEMORY")
    // Incremental vacuum frees pages later via rare PRAGMA incremental_vacuum — not every refresh.
    try {
      db.execSQL("PRAGMA auto_vacuum=INCREMENTAL")
    } catch (_: Throwable) {
      /* older SQLite / already set */
    }
  }

  override fun onCreate(db: SQLiteDatabase) {
    createProgrammeTable(db, LIVE_TABLE)
    createProgrammeTable(db, STAGING_TABLE)
    createAliasTable(db)
    createMetaTable(db)
    createPlaylistTable(db)
    createMatchTable(db)
    createStopUpdateTable(db)
    createProgrammeSearchTable(db)
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_lookup ON $LIVE_TABLE(channel_id, start_time, end_time)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_window ON $LIVE_TABLE(start_time, end_time)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_staging_order ON $STAGING_TABLE(channel_id, start_time, id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_alias_norm ON $ALIAS_TABLE(normalized_key)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_norm_id ON $PLAYLIST_TABLE(norm_id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_norm_name ON $PLAYLIST_TABLE(norm_name)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_deleted ON $PLAYLIST_TABLE(deleted_at)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_match_xmltv ON $MATCH_TABLE(xmltv_id)")
  }

  private fun createProgrammeTable(db: SQLiteDatabase, table: String) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL
      )
      """.trimIndent()
    )
  }

  private fun createAliasTable(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $ALIAS_TABLE (
        channel_id TEXT NOT NULL,
        alias_kind TEXT NOT NULL,
        alias_value TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        PRIMARY KEY (alias_kind, normalized_key, channel_id)
      )
      """.trimIndent()
    )
  }

  private fun createMetaTable(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $META_TABLE (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
      """.trimIndent()
    )
  }

  private fun createPlaylistTable(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $PLAYLIST_TABLE (
        playlist_id TEXT PRIMARY KEY NOT NULL,
        raw_tvg_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        logo TEXT,
        group_title TEXT,
        norm_id TEXT NOT NULL,
        norm_name TEXT NOT NULL,
        stream_url TEXT NOT NULL DEFAULT '',
        stream_type TEXT NOT NULL DEFAULT 'unknown',
        provider_position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER NOT NULL DEFAULT 0
      )
      """.trimIndent()
    )
  }

  private fun createMatchTable(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $MATCH_TABLE (
        playlist_id TEXT PRIMARY KEY NOT NULL,
        xmltv_id TEXT NOT NULL DEFAULT '',
        logo_xmltv_id TEXT NOT NULL DEFAULT '',
        ambiguous INTEGER NOT NULL DEFAULT 0,
        match_policy TEXT NOT NULL DEFAULT 'full',
        manual INTEGER NOT NULL DEFAULT 0,
        guide_epoch INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
      """.trimIndent()
    )
  }

  private fun createStopUpdateTable(db: SQLiteDatabase) {
    db.execSQL(
      "CREATE TABLE IF NOT EXISTS $STOP_UPDATE_TABLE " +
        "(row_id INTEGER PRIMARY KEY NOT NULL, end_time INTEGER NOT NULL)"
    )
  }

  private fun createProgrammeSearchTable(db: SQLiteDatabase) {
    db.execSQL(
      "CREATE VIRTUAL TABLE IF NOT EXISTS $FTS_TABLE USING fts4(" +
        "programme_id INTEGER, channel_id TEXT, title TEXT, description TEXT, category TEXT)"
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // Additive only — never DROP live guide on upgrade (would fight last-good / Phase 4).
    if (oldVersion < 3) {
      ensureColumn(db, LIVE_TABLE, "category", "TEXT")
      ensureColumn(db, STAGING_TABLE, "category", "TEXT")
      createAliasTable(db)
      createMetaTable(db)
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_lookup ON $LIVE_TABLE(channel_id, start_time, end_time)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_window ON $LIVE_TABLE(start_time, end_time)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_staging_order ON $STAGING_TABLE(channel_id, start_time, id)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_alias_norm ON $ALIAS_TABLE(normalized_key)")
    }
    if (oldVersion < 4) {
      createPlaylistTable(db)
      createMatchTable(db)
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_norm_id ON $PLAYLIST_TABLE(norm_id)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_norm_name ON $PLAYLIST_TABLE(norm_name)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_match_xmltv ON $MATCH_TABLE(xmltv_id)")
    }
    if (oldVersion < 5) {
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_staging_order ON $STAGING_TABLE(channel_id, start_time, id)")
    }
    if (oldVersion < 6) {
      createStopUpdateTable(db)
    }
    if (oldVersion < 7) {
      // Version 6 stored Unix milliseconds. SQLite comparisons and indexes are
      // smaller/faster in seconds; bridge methods continue exposing millis.
      db.execSQL("UPDATE $LIVE_TABLE SET start_time = start_time / 1000, end_time = end_time / 1000 WHERE start_time > 100000000000")
      db.execSQL("UPDATE $STAGING_TABLE SET start_time = start_time / 1000, end_time = end_time / 1000 WHERE start_time > 100000000000")
      createProgrammeSearchTable(db)
      rebuildProgrammeSearch(db)
    }
    if (oldVersion < 8) {
      // Provider refreshes use a TiViMate-style soft-delete marker so row
      // identities and user-owned relationships survive temporary removals.
      ensureColumn(db, PLAYLIST_TABLE, "deleted_at", "INTEGER NOT NULL DEFAULT 0")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_deleted ON $PLAYLIST_TABLE(deleted_at)")
    }
    if (oldVersion < 9) {
      // Persist the provider-owned playback fields relationally so Android cold
      // start no longer depends on serializing the entire channel catalog to JSON.
      ensureColumn(db, PLAYLIST_TABLE, "stream_url", "TEXT NOT NULL DEFAULT ''")
      ensureColumn(db, PLAYLIST_TABLE, "stream_type", "TEXT NOT NULL DEFAULT 'unknown'")
      ensureColumn(db, PLAYLIST_TABLE, "provider_position", "INTEGER NOT NULL DEFAULT 0")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_active_position ON $PLAYLIST_TABLE(deleted_at, provider_position)")
    }
  }

  private fun ensureColumn(db: SQLiteDatabase, table: String, column: String, type: String) {
    db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
      val nameIndex = cursor.getColumnIndex("name")
      while (cursor.moveToNext()) {
        if (nameIndex >= 0 && cursor.getString(nameIndex) == column) return
      }
    }
    db.execSQL("ALTER TABLE $table ADD COLUMN $column $type")
  }

  /** Quick integrity check once per process. Never destroy last-good data automatically. */
  private var checkedThisProcess = false

  fun ensureHealthy(): Boolean {
    return try {
      if (!checkedThisProcess) {
        checkedThisProcess = true
        val db = readableDatabase
        db.rawQuery("PRAGMA quick_check", null).use { cursor ->
          if (!cursor.moveToFirst()) {
            return false
          }
          val result = cursor.getString(0) ?: ""
          if (result != "ok" && !result.equals("ok", ignoreCase = true)) {
            return false
          }
        }
      }
      // Cheap touch so missing-schema upgrades surface early without vacuum cost.
      countTable(LIVE_TABLE)
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun insertBatch(db: SQLiteDatabase, table: String, batch: List<NativeEpgProgram>) {
    if (batch.isEmpty()) return
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        """
        INSERT INTO $table(channel_id, title, description, category, start_time, end_time)
        VALUES (?, ?, ?, ?, ?, ?)
        """.trimIndent()
      )
      try {
        for (program in batch) {
          statement.clearBindings()
          statement.bindString(1, program.channelId)
          statement.bindString(2, program.title)
          if (program.description == null) statement.bindNull(3)
          else statement.bindString(3, program.description)
          if (program.category.isNullOrBlank()) statement.bindNull(4)
          else statement.bindString(4, program.category)
          statement.bindLong(5, toEpochSeconds(program.startMs))
          statement.bindLong(6, toEpochSeconds(program.endMs))
          statement.executeInsert()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  private fun countTable(table: String): Long {
    readableDatabase.rawQuery("SELECT COUNT(*) FROM $table", null).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getLong(0) else 0L
    }
  }

  /**
   * After staging is filled: if a row used the default +30m stop (or overlaps the
   * next show), set end_time to the next programme start on the same channel.
   * Runs once at ingest — never during guide cell paint.
   */
  fun inferMissingStopsFromNextProgram(
    defaultDurationMs: Long,
    maxDurationMs: Long,
  ) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      // Stage corrections in SQLite rather than retaining one Pair object for
      // every programme in the JVM heap. Very large provider feeds therefore
      // keep constant Java/Kotlin memory during finalization.
      createStopUpdateTable(db)
      db.delete(STOP_UPDATE_TABLE, null, null)
      val insertUpdate = db.compileStatement(
        "INSERT OR REPLACE INTO $STOP_UPDATE_TABLE(row_id, end_time) VALUES (?, ?)"
      )
      try {
        db.rawQuery(
          """
          SELECT id, channel_id, start_time, end_time
          FROM $STAGING_TABLE
          ORDER BY channel_id ASC, start_time ASC, id ASC
          """.trimIndent(),
          null,
        ).use { cursor ->
          var prevId = -1L
          var prevChannel = ""
          var prevStart = 0L
          var prevEnd = 0L
          while (cursor.moveToNext()) {
            val id = cursor.getLong(0)
            val channelId = cursor.getString(1)
            val startMs = cursor.getLong(2)
            val endMs = cursor.getLong(3)
            if (prevId >= 0L && prevChannel == channelId && startMs > prevStart) {
              val usedDefault = prevEnd == prevStart + toDurationSeconds(defaultDurationMs)
              val overlapsNext = prevEnd > startMs
              if (usedDefault || overlapsNext) {
                val duration = startMs - prevStart
                if (duration > 0L && duration <= toDurationSeconds(maxDurationMs)) {
                  insertUpdate.clearBindings()
                  insertUpdate.bindLong(1, prevId)
                  insertUpdate.bindLong(2, startMs)
                  insertUpdate.executeInsert()
                }
              }
            }
            prevId = id
            prevChannel = channelId
            prevStart = startMs
            prevEnd = endMs
          }
        }
      } finally {
        insertUpdate.close()
      }
      db.execSQL(
        """
        UPDATE $STAGING_TABLE
        SET end_time = (
          SELECT end_time FROM $STOP_UPDATE_TABLE u WHERE u.row_id = $STAGING_TABLE.id
        )
        WHERE id IN (SELECT row_id FROM $STOP_UPDATE_TABLE)
        """.trimIndent()
      )
      db.delete(STOP_UPDATE_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /**
   * Batch-replace XMLTV alias rows used for SQL-side joins / future native rematch.
   * Each triple is (channelId, aliasKind, aliasValue).
   */
  fun replaceChannelAliases(aliases: List<Triple<String, String, String>>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(ALIAS_TABLE, null, null)
      if (aliases.isNotEmpty()) {
        val statement = db.compileStatement(
          """
          INSERT OR REPLACE INTO $ALIAS_TABLE(channel_id, alias_kind, alias_value, normalized_key)
          VALUES (?, ?, ?, ?)
          """.trimIndent()
        )
        try {
          for ((channelId, kind, value) in aliases) {
            if (channelId.isBlank() || kind.isBlank() || value.isBlank()) continue
            statement.clearBindings()
            statement.bindString(1, channelId)
            statement.bindString(2, kind)
            statement.bindString(3, value)
            statement.bindString(4, normalizeKey(value))
            statement.executeInsert()
          }
        } finally {
          statement.close()
        }
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /** Paged XMLTV channel directory. Only id/name rows cross the bridge. */
  fun listDisplayNameAliases(query: String, offset: Int, limit: Int): EpgAliasPage {
    val safeLimit = limit.coerceIn(1, 100)
    val safeOffset = offset.coerceAtLeast(0)
    val normalized = normalizeKey(query.trim())
    val where = if (normalized.isEmpty()) "alias_kind = ?" else "alias_kind = ? AND normalized_key LIKE ?"
    val args = if (normalized.isEmpty()) arrayOf("display_name") else arrayOf("display_name", "%$normalized%")
    val total = readableDatabase.rawQuery(
      "SELECT COUNT(*) FROM $ALIAS_TABLE WHERE $where",
      args,
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }
    if (total <= 0) return EpgAliasPage(0, emptyList())
    val rows = ArrayList<EpgAliasRow>(minOf(safeLimit, total))
    val pageArgs = ArrayList<String>(args.size + 2).apply {
      addAll(args)
      add(safeLimit.toString())
      add(safeOffset.toString())
    }
    readableDatabase.rawQuery(
      "SELECT channel_id, alias_value FROM $ALIAS_TABLE WHERE $where ORDER BY alias_value COLLATE NOCASE ASC LIMIT ? OFFSET ?",
      pageArgs.toTypedArray(),
    ).use { cursor ->
      while (cursor.moveToNext()) rows.add(EpgAliasRow(cursor.getString(0), cursor.getString(1)))
    }
    return EpgAliasPage(total, rows)
  }

  /** Active provider catalog ordered by persisted playlist position. */
  fun activePlaylistChannels(): List<PlaylistChannelRow> {
    val rows = ArrayList<PlaylistChannelRow>()
    readableDatabase.rawQuery(
      """
      SELECT playlist_id, raw_tvg_id, name, COALESCE(logo, ''),
             COALESCE(group_title, ''), stream_url, stream_type, provider_position
      FROM $PLAYLIST_TABLE
      WHERE deleted_at = 0 AND stream_url != ''
      ORDER BY provider_position ASC, name COLLATE NOCASE ASC
      """.trimIndent(),
      null,
    ).use { cursor ->
      while (cursor.moveToNext()) {
        rows.add(
          PlaylistChannelRow(
            playlistId = cursor.getString(0),
            rawTvgId = cursor.getString(1),
            name = cursor.getString(2),
            logo = cursor.getString(3),
            groupTitle = cursor.getString(4),
            streamUrl = cursor.getString(5),
            streamType = cursor.getString(6),
            providerPosition = cursor.getInt(7),
          )
        )
      }
    }
    return rows
  }

  /** Replace playlist channel rows (independent of EPG live table). */
  fun playlistFingerprintMatches(fingerprint: String): Boolean {
    return fingerprint.isNotBlank() && getMeta(PLAYLIST_CONTENT_FINGERPRINT_KEY) == fingerprint
  }

  fun replacePlaylistChannels(
    rows: List<PlaylistChannelRow>,
    playlistEpoch: Long,
    contentFingerprint: String,
  ): Boolean {
    val fingerprint = contentFingerprint.ifBlank { fingerprintPlaylistChannels(rows) }
    if (getMeta(PLAYLIST_CONTENT_FINGERPRINT_KEY) == fingerprint) return false
    val db = writableDatabase
    val now = System.currentTimeMillis()
    db.beginTransaction()
    try {
      db.delete(PLAYLIST_TABLE, null, null)
      if (rows.isNotEmpty()) {
        val statement = db.compileStatement(
          """
          INSERT OR REPLACE INTO $PLAYLIST_TABLE(
            playlist_id, raw_tvg_id, name, logo, group_title, norm_id, norm_name, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """.trimIndent()
        )
        try {
          for (row in rows) {
            if (row.playlistId.isBlank()) continue
            val rawTvg = row.rawTvgId.trim()
            val normSource = if (rawTvg.isNotEmpty()) rawTvg else row.playlistId
            statement.clearBindings()
            statement.bindString(1, row.playlistId)
            statement.bindString(2, rawTvg)
            statement.bindString(3, row.name)
            statement.bindString(4, row.logo)
            statement.bindString(5, row.groupTitle)
            statement.bindString(6, normalizeKey(normSource))
            statement.bindString(7, normalizeKey(row.name))
            statement.bindLong(8, now)
            statement.executeInsert()
          }
        } finally {
          statement.close()
        }
      }
      setMeta("playlist_epoch", playlistEpoch.toString())
      setMeta(PLAYLIST_CONTENT_FINGERPRINT_KEY, fingerprint)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return true
  }

  private fun fingerprintPlaylistChannels(rows: List<PlaylistChannelRow>): String {
    val digest = MessageDigest.getInstance("SHA-256")
    fun add(value: String) {
      digest.update(value.toByteArray(Charsets.UTF_8))
      digest.update(0.toByte())
    }
    for (row in rows) {
      add(row.playlistId)
      add(row.rawTvgId)
      add(row.name)
      add(row.logo)
      add(row.groupTitle)
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  /** Replace resolved playlist→XMLTV matches used by queryGuideWindow joins. */
  fun replacePlaylistEpgMatches(rows: List<PlaylistEpgMatchRow>, guideEpoch: Long): Boolean {
    val fingerprint = fingerprintPlaylistEpgMatches(rows)
    if (getMeta(MATCH_CONTENT_FINGERPRINT_KEY) == fingerprint) return false
    val db = writableDatabase
    val now = System.currentTimeMillis()
    db.beginTransaction()
    try {
      db.delete(MATCH_TABLE, null, null)
      if (rows.isNotEmpty()) {
        val statement = db.compileStatement(
          """
          INSERT OR REPLACE INTO $MATCH_TABLE(
            playlist_id, xmltv_id, logo_xmltv_id, ambiguous, match_policy, manual, guide_epoch, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """.trimIndent()
        )
        try {
          for (row in rows) {
            if (row.playlistId.isBlank()) continue
            statement.clearBindings()
            statement.bindString(1, row.playlistId)
            statement.bindString(2, row.xmltvId)
            statement.bindString(3, row.logoXmltvId)
            statement.bindLong(4, if (row.ambiguous) 1L else 0L)
            statement.bindString(5, row.matchPolicy.ifBlank { "full" })
            statement.bindLong(6, if (row.manual) 1L else 0L)
            statement.bindLong(7, guideEpoch)
            statement.bindLong(8, now)
            statement.executeInsert()
          }
        } finally {
          statement.close()
        }
      }
      setMeta("match_guide_epoch", guideEpoch.toString())
      setMeta(MATCH_CONTENT_FINGERPRINT_KEY, fingerprint)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return true
  }

  private fun fingerprintPlaylistEpgMatches(rows: List<PlaylistEpgMatchRow>): String {
    val digest = MessageDigest.getInstance("SHA-256")
    fun add(value: String) {
      digest.update(value.toByteArray(Charsets.UTF_8))
      digest.update(0.toByte())
    }
    for (row in rows) {
      add(row.playlistId)
      add(row.xmltvId)
      add(row.logoXmltvId)
      add(if (row.ambiguous) "1" else "0")
      add(row.matchPolicy)
      add(if (row.manual) "1" else "0")
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  /**
   * Join playlist matches to live programmes and return rows keyed by playlist id
   * (channelId field carries playlist_id for the JS bridge).
   */
  fun queryGuideWindow(
    startMs: Long,
    endMs: Long,
    playlistChannelIds: Collection<String>,
  ): List<NativeEpgProgram> {
    if (playlistChannelIds.isEmpty()) return emptyList()
    val result = ArrayList<NativeEpgProgram>()
    for (chunk in playlistChannelIds.chunked(IN_CLAUSE_CHUNK)) {
      if (chunk.isEmpty()) continue
      val placeholders = chunk.joinToString(",") { "?" }
      val args = ArrayList<String>(chunk.size + 2)
      args.addAll(chunk)
      args.add(toEpochSeconds(startMs).toString())
      args.add(toEpochSeconds(endMs).toString())
      readableDatabase.rawQuery(
        """
        SELECT m.playlist_id AS channel_id, p.title, p.description, p.category, p.start_time, p.end_time
        FROM $MATCH_TABLE m
        INNER JOIN $LIVE_TABLE p ON p.channel_id = m.xmltv_id
        WHERE m.playlist_id IN ($placeholders)
          AND m.xmltv_id != ''
          AND p.end_time > ?
          AND p.start_time < ?
        ORDER BY m.playlist_id ASC, p.start_time ASC
        """.trimIndent(),
        args.toTypedArray(),
      ).use { cursor -> appendPrograms(cursor, result) }
    }
    return result
  }

  fun setMeta(key: String, value: String) {
    writableDatabase.execSQL(
      "INSERT OR REPLACE INTO $META_TABLE(key, value) VALUES (?, ?)",
      arrayOf(key, value),
    )
  }

  fun getMeta(key: String): String? {
    readableDatabase.rawQuery(
      "SELECT value FROM $META_TABLE WHERE key = ? LIMIT 1",
      arrayOf(key),
    ).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getString(0) else null
    }
  }

  /**
   * Parse/network iteration happens outside a long SQLite transaction. Each
   * 1,000-row batch is committed to staging, then the final live-table swap is
   * deliberately tiny. Readers therefore keep the last-good guide throughout
   * a slow XMLTV refresh and a failed/empty refresh never destroys it.
   */
  fun replaceBatches(batches: Sequence<List<NativeEpgProgram>>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(STAGING_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }

    try {
      var batchNumber = 0
      for (batch in batches) {
        insertBatch(db, STAGING_TABLE, batch)
        batchNumber += 1
        // Content-Length is often absent on chunked/gzipped provider feeds.
        // Recheck while staging grows so the atomic last-good LIVE table remains
        // protected even when the pre-download estimate could not know its size.
        if (batchNumber % STORAGE_RECHECK_BATCHES == 0) {
          assertRefreshStorageAvailable()
        }
      }

      val stagingCount = countTable(STAGING_TABLE)
      if (stagingCount <= 0L) {
        throw IllegalStateException("Refusing to replace live EPG with an empty feed")
      }

      inferMissingStopsFromNextProgram(DEFAULT_PROGRAMME_DURATION_MS, MAX_PROGRAMME_DURATION_MS)

      db.beginTransaction()
      try {
        db.delete(LIVE_TABLE, null, null)
        db.execSQL(
          """
          INSERT INTO $LIVE_TABLE(channel_id, title, description, category, start_time, end_time)
          SELECT channel_id, title, description, category, start_time, end_time
          FROM $STAGING_TABLE
          """.trimIndent()
        )
        rebuildProgrammeSearch(db)
        db.delete(STAGING_TABLE, null, null)
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    } catch (failure: Throwable) {
      // Parsing, storage, and finalization failures retain LIVE and remove the
      // partial staging rows so a failed refresh cannot permanently consume the
      // remaining storage needed by the next attempt.
      try {
        db.beginTransaction()
        try {
          db.delete(STAGING_TABLE, null, null)
          db.setTransactionSuccessful()
        } finally {
          db.endTransaction()
        }
        db.execSQL("PRAGMA wal_checkpoint(PASSIVE)")
      } catch (_: Throwable) {
        // Preserve the original failure and last-good LIVE data.
      }
      throw failure
    }
  }

  fun queryWindow(startMs: Long, endMs: Long, channelIds: Collection<String>? = null): List<NativeEpgProgram> {
    if (channelIds != null && channelIds.isEmpty()) return emptyList()

    val result = ArrayList<NativeEpgProgram>()
    if (channelIds == null) {
      readableDatabase.query(
        LIVE_TABLE,
        arrayOf("channel_id", "title", "description", "category", "start_time", "end_time"),
        "end_time > ? AND start_time < ?",
        arrayOf(toEpochSeconds(startMs).toString(), toEpochSeconds(endMs).toString()),
        null,
        null,
        "channel_id ASC, start_time ASC",
      ).use { cursor -> appendPrograms(cursor, result) }
      return result
    }

    for (chunk in channelIds.chunked(IN_CLAUSE_CHUNK)) {
      if (chunk.isEmpty()) continue
      val placeholders = chunk.joinToString(",") { "?" }
      val args = ArrayList<String>(chunk.size + 2)
      args.addAll(chunk)
      args.add(toEpochSeconds(startMs).toString())
      args.add(toEpochSeconds(endMs).toString())
      readableDatabase.rawQuery(
        """
        SELECT channel_id, title, description, category, start_time, end_time
        FROM $LIVE_TABLE
        WHERE channel_id IN ($placeholders)
          AND end_time > ?
          AND start_time < ?
        ORDER BY channel_id ASC, start_time ASC
        """.trimIndent(),
        args.toTypedArray(),
      ).use { cursor -> appendPrograms(cursor, result) }
    }
    return result
  }

  private fun appendPrograms(cursor: android.database.Cursor, result: MutableList<NativeEpgProgram>) {
    val channelColumn = cursor.getColumnIndexOrThrow("channel_id")
    val titleColumn = cursor.getColumnIndexOrThrow("title")
    val descriptionColumn = cursor.getColumnIndexOrThrow("description")
    val categoryColumn = cursor.getColumnIndex("category")
    val startColumn = cursor.getColumnIndexOrThrow("start_time")
    val endColumn = cursor.getColumnIndexOrThrow("end_time")
    while (cursor.moveToNext()) {
      result.add(
        NativeEpgProgram(
          channelId = cursor.getString(channelColumn),
          title = cursor.getString(titleColumn),
          description = if (cursor.isNull(descriptionColumn)) null else cursor.getString(descriptionColumn),
          category = if (categoryColumn >= 0 && !cursor.isNull(categoryColumn)) cursor.getString(categoryColumn) else null,
          startMs = toEpochMillis(cursor.getLong(startColumn)),
          endMs = toEpochMillis(cursor.getLong(endColumn)),
        )
      )
    }
  }

  fun deleteExpired(beforeMs: Long): Int {
    val deleted = writableDatabase.delete(LIVE_TABLE, "end_time < ?", arrayOf(toEpochSeconds(beforeMs).toString()))
    try {
      writableDatabase.execSQL("PRAGMA wal_checkpoint(PASSIVE)")
    } catch (_: Throwable) {
      /* ignore */
    }
    return deleted
  }

  /**
   * Rare idle reclaim — call after a large expiry delete or on an idle path only.
   * Never from guide paint / D-pad handlers.
   */
  fun maybeIncrementalVacuum(minDeletedRows: Int, deletedRows: Int) {
    if (deletedRows < minDeletedRows) return
    try {
      writableDatabase.execSQL("PRAGMA incremental_vacuum(64)")
    } catch (_: Throwable) {
      /* ignore */
    }
  }

  fun clear() {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(LIVE_TABLE, null, null)
      db.delete(STAGING_TABLE, null, null)
      db.delete(ALIAS_TABLE, null, null)
      db.delete(PLAYLIST_TABLE, null, null)
      db.delete(MATCH_TABLE, null, null)
      db.delete(STOP_UPDATE_TABLE, null, null)
      db.delete(FTS_TABLE, null, null)
      db.delete(META_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun count(): Long = countTable(LIVE_TABLE)

  fun matchedXmltvIdsForPlaylistIds(playlistIds: Collection<String>): Set<String> {
    if (playlistIds.isEmpty()) return emptySet()
    val result = LinkedHashSet<String>()
    for (chunk in playlistIds.chunked(IN_CLAUSE_CHUNK)) {
      if (chunk.isEmpty()) continue
      val placeholders = chunk.joinToString(",") { "?" }
      readableDatabase.rawQuery(
        "SELECT xmltv_id FROM $MATCH_TABLE WHERE playlist_id IN ($placeholders) AND xmltv_id != ''",
        chunk.toTypedArray(),
      ).use { cursor ->
        while (cursor.moveToNext()) cursor.getString(0)?.takeIf { it.isNotBlank() }?.let(result::add)
      }
    }
    return result
  }

  fun searchProgrammes(
    query: String,
    limit: Int = 80,
    excludedChannelIds: Set<String> = emptySet(),
  ): List<NativeEpgProgram> {
    val match = query.trim().replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()
    if (match.isEmpty()) return emptyList()
    val result = ArrayList<NativeEpgProgram>()
    readableDatabase.rawQuery(
      """
      SELECT p.channel_id, p.title, p.description, p.category, p.start_time, p.end_time
      FROM $FTS_TABLE f
      INNER JOIN $LIVE_TABLE p ON p.id = f.programme_id
      WHERE $FTS_TABLE MATCH ? AND p.end_time >= ?
      ORDER BY p.start_time ASC
      LIMIT ?
      """.trimIndent(),
      arrayOf(
        "$match*",
        toEpochSeconds(System.currentTimeMillis()).toString(),
        (if (excludedChannelIds.isEmpty()) limit else (limit * 3)).coerceIn(1, 250).toString(),
      ),
    ).use { cursor -> appendPrograms(cursor, result) }
    if (excludedChannelIds.isEmpty()) return result.take(limit.coerceIn(1, 250))
    return result.asSequence()
      .filterNot { it.channelId in excludedChannelIds }
      .take(limit.coerceIn(1, 250))
      .toList()
  }

  private fun rebuildProgrammeSearch(db: SQLiteDatabase) {
    createProgrammeSearchTable(db)
    db.delete(FTS_TABLE, null, null)
    db.execSQL(
      "INSERT INTO $FTS_TABLE(programme_id, channel_id, title, description, category) " +
        "SELECT id, channel_id, title, COALESCE(description, ''), COALESCE(category, '') FROM $LIVE_TABLE"
    )
  }

  private fun toEpochSeconds(milliseconds: Long): Long = Math.floorDiv(milliseconds, 1000L)
  private fun toEpochMillis(seconds: Long): Long = seconds * 1000L
  private fun toDurationSeconds(milliseconds: Long): Long = (milliseconds + 999L) / 1000L

  companion object {
    private const val STORAGE_RECHECK_BATCHES = 32
    private const val DATABASE_VERSION = 9
    private const val LIVE_TABLE = "epg_programmes"
    private const val STAGING_TABLE = "epg_programmes_staging"
    private const val ALIAS_TABLE = "epg_channel_aliases"
    private const val META_TABLE = "epg_meta"
    private const val PLAYLIST_TABLE = "playlist_channels"
    private const val MATCH_TABLE = "playlist_epg_matches"
    private const val STOP_UPDATE_TABLE = "epg_stop_updates"
    private const val FTS_TABLE = "epg_programmes_fts"
    private const val PLAYLIST_CONTENT_FINGERPRINT_KEY = "playlist_content_fingerprint"
    private const val MATCH_CONTENT_FINGERPRINT_KEY = "match_content_fingerprint"
    private const val IN_CLAUSE_CHUNK = 400
    private const val DEFAULT_PROGRAMME_DURATION_MS = 30L * 60L * 1000L
    private const val MAX_PROGRAMME_DURATION_MS = 24L * 60L * 60L * 1000L

    fun normalizeKey(value: String): String {
      return value.lowercase().replace(Regex("[^a-z0-9]+"), "")
    }
  }
}
