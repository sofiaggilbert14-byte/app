package com.charmiptv.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

internal data class NativeEpgProgram(
  val channelId: String,
  val title: String,
  val description: String?,
  val category: String?,
  val startMs: Long,
  val endMs: Long,
)

/**
 * Native EPG store for Fire TV.
 *
 * Design constraints (do not regress):
 * - Independent last-good LIVE table (never couple playlist wipe to EPG wipe)
 * - Additive schema migrations (never DROP on upgrade)
 * - Staging → atomic LIVE swap; refuse empty replace
 * - Rare idle vacuum only (never on every refresh / surf)
 */
internal class EpgDatabase(context: Context) :
  SQLiteOpenHelper(context, "charm_epg_v3.db", null, DATABASE_VERSION) {

  override fun onConfigure(db: SQLiteDatabase) {
    super.onConfigure(db)
    db.setForeignKeyConstraintsEnabled(false)
    db.rawQuery("PRAGMA journal_mode=WAL", null).close()
    db.execSQL("PRAGMA synchronous=NORMAL")
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
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_lookup ON $LIVE_TABLE(channel_id, start_time, end_time)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_window ON $LIVE_TABLE(start_time, end_time)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_alias_norm ON $ALIAS_TABLE(normalized_key)")
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

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // Additive only — never DROP live guide on upgrade (would fight last-good / Phase 4).
    if (oldVersion < 3) {
      ensureColumn(db, LIVE_TABLE, "category", "TEXT")
      ensureColumn(db, STAGING_TABLE, "category", "TEXT")
      createAliasTable(db)
      createMetaTable(db)
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_lookup ON $LIVE_TABLE(channel_id, start_time, end_time)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_window ON $LIVE_TABLE(start_time, end_time)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_alias_norm ON $ALIAS_TABLE(normalized_key)")
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

  /** Quick integrity check once per process; recreate empty schema if corrupt. Does not touch playlist cache. */
  private var checkedThisProcess = false

  fun ensureHealthy(): Boolean {
    return try {
      if (!checkedThisProcess) {
        checkedThisProcess = true
        val db = readableDatabase
        db.rawQuery("PRAGMA quick_check", null).use { cursor ->
          if (!cursor.moveToFirst()) {
            recreateEmpty()
            return false
          }
          val result = cursor.getString(0) ?: ""
          if (result != "ok" && !result.equals("ok", ignoreCase = true)) {
            recreateEmpty()
            return false
          }
        }
      }
      // Cheap touch so missing-schema upgrades surface early without vacuum cost.
      countTable(LIVE_TABLE)
      true
    } catch (_: Throwable) {
      recreateEmpty()
      false
    }
  }

  private fun recreateEmpty() {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.execSQL("DROP TABLE IF EXISTS $LIVE_TABLE")
      db.execSQL("DROP TABLE IF EXISTS $STAGING_TABLE")
      db.execSQL("DROP TABLE IF EXISTS $ALIAS_TABLE")
      db.execSQL("DROP TABLE IF EXISTS $META_TABLE")
      onCreate(db)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
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
          statement.bindLong(5, program.startMs)
          statement.bindLong(6, program.endMs)
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
      val updates = ArrayList<Pair<Long, Long>>()
      while (cursor.moveToNext()) {
        val id = cursor.getLong(0)
        val channelId = cursor.getString(1)
        val startMs = cursor.getLong(2)
        val endMs = cursor.getLong(3)
        if (prevId >= 0L && prevChannel == channelId && startMs > prevStart) {
          val usedDefault = prevEnd == prevStart + defaultDurationMs
          val overlapsNext = prevEnd > startMs
          if (usedDefault || overlapsNext) {
            val inferred = startMs
            val duration = inferred - prevStart
            if (duration > 0L && duration <= maxDurationMs) {
              updates.add(prevId to inferred)
            }
          }
        }
        prevId = id
        prevChannel = channelId
        prevStart = startMs
        prevEnd = endMs
      }
      if (updates.isEmpty()) return
      db.beginTransaction()
      try {
        val statement = db.compileStatement("UPDATE $STAGING_TABLE SET end_time = ? WHERE id = ?")
        try {
          for ((rowId, endTime) in updates) {
            statement.clearBindings()
            statement.bindLong(1, endTime)
            statement.bindLong(2, rowId)
            statement.executeUpdateDelete()
          }
        } finally {
          statement.close()
        }
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    }
  }

  fun replaceChannelAliases(aliases: List<Triple<String, String, String>>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(ALIAS_TABLE, null, null)
      if (aliases.isNotEmpty()) {
        val statement = db.compileStatement(
          """
          INSERT OR IGNORE INTO $ALIAS_TABLE(channel_id, alias_kind, alias_value, normalized_key)
          VALUES (?, ?, ?, ?)
          """.trimIndent()
        )
        try {
          for ((channelId, kind, value) in aliases) {
            val normalized = normalizeKey(value)
            if (channelId.isBlank() || normalized.isEmpty()) continue
            statement.clearBindings()
            statement.bindString(1, channelId)
            statement.bindString(2, kind)
            statement.bindString(3, value)
            statement.bindString(4, normalized)
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

    for (batch in batches) {
      insertBatch(db, STAGING_TABLE, batch)
    }

    val stagingCount = countTable(STAGING_TABLE)
    if (stagingCount <= 0L) {
      db.beginTransaction()
      try {
        db.delete(STAGING_TABLE, null, null)
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
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
      db.delete(STAGING_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
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
        arrayOf(startMs.toString(), endMs.toString()),
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
      args.add(startMs.toString())
      args.add(endMs.toString())
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
          startMs = cursor.getLong(startColumn),
          endMs = cursor.getLong(endColumn),
        )
      )
    }
  }

  fun queryCurrent(nowMs: Long): List<NativeEpgProgram> {
    val result = ArrayList<NativeEpgProgram>()
    readableDatabase.rawQuery(
      """
      SELECT channel_id, title, description, category, start_time, end_time
      FROM $LIVE_TABLE
      WHERE start_time <= ? AND end_time > ?
      ORDER BY channel_id ASC, start_time DESC
      """.trimIndent(),
      arrayOf(nowMs.toString(), nowMs.toString()),
    ).use { cursor ->
      val seen = HashSet<String>()
      while (cursor.moveToNext()) {
        val channelId = cursor.getString(0)
        if (!seen.add(channelId)) continue
        result.add(
          NativeEpgProgram(
            channelId = channelId,
            title = cursor.getString(1),
            description = if (cursor.isNull(2)) null else cursor.getString(2),
            category = if (cursor.isNull(3)) null else cursor.getString(3),
            startMs = cursor.getLong(4),
            endMs = cursor.getLong(5),
          )
        )
      }
    }
    return result
  }

  fun deleteExpired(beforeMs: Long): Int {
    val deleted = writableDatabase.delete(LIVE_TABLE, "end_time < ?", arrayOf(beforeMs.toString()))
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
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun count(): Long = countTable(LIVE_TABLE)

  companion object {
    private const val DATABASE_VERSION = 3
    private const val LIVE_TABLE = "epg_programmes"
    private const val STAGING_TABLE = "epg_programmes_staging"
    private const val ALIAS_TABLE = "epg_channel_aliases"
    private const val META_TABLE = "epg_meta"
    private const val IN_CLAUSE_CHUNK = 400
    private const val DEFAULT_PROGRAMME_DURATION_MS = 30L * 60L * 1000L
    private const val MAX_PROGRAMME_DURATION_MS = 24L * 60L * 60L * 1000L

    fun normalizeKey(value: String): String {
      return value.lowercase().replace(Regex("[^a-z0-9]+"), "")
    }
  }
}
