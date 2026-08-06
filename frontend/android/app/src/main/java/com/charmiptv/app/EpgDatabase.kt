package com.charmiptv.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

internal data class NativeEpgProgram(
  val channelId: String,
  val title: String,
  val description: String?,
  val startMs: Long,
  val endMs: Long,
)

internal class EpgDatabase(context: Context) :
  SQLiteOpenHelper(context, "charm_epg_v3.db", null, DATABASE_VERSION) {

  override fun onConfigure(db: SQLiteDatabase) {
    super.onConfigure(db)
    db.setForeignKeyConstraintsEnabled(false)
    db.rawQuery("PRAGMA journal_mode=WAL", null).close()
    db.execSQL("PRAGMA synchronous=NORMAL")
    db.execSQL("PRAGMA temp_store=MEMORY")
  }

  override fun onCreate(db: SQLiteDatabase) {
    createProgrammeTable(db, LIVE_TABLE)
    createProgrammeTable(db, STAGING_TABLE)
    db.execSQL("CREATE INDEX idx_epg_lookup ON $LIVE_TABLE(channel_id, start_time, end_time)")
    db.execSQL("CREATE INDEX idx_epg_window ON $LIVE_TABLE(start_time, end_time)")
  }

  private fun createProgrammeTable(db: SQLiteDatabase, table: String) {
    db.execSQL(
      """
      CREATE TABLE $table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL
      )
      """.trimIndent()
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    db.execSQL("DROP TABLE IF EXISTS $LIVE_TABLE")
    db.execSQL("DROP TABLE IF EXISTS $STAGING_TABLE")
    onCreate(db)
  }

  private fun insertBatch(db: SQLiteDatabase, table: String, batch: List<NativeEpgProgram>) {
    if (batch.isEmpty()) return
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        """
        INSERT INTO $table(channel_id, title, description, start_time, end_time)
        VALUES (?, ?, ?, ?, ?)
        """.trimIndent()
      )
      try {
        for (program in batch) {
          statement.clearBindings()
          statement.bindString(1, program.channelId)
          statement.bindString(2, program.title)
          if (program.description == null) statement.bindNull(3)
          else statement.bindString(3, program.description)
          statement.bindLong(4, program.startMs)
          statement.bindLong(5, program.endMs)
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

  /**
   * Parse/network iteration happens outside a long SQLite transaction. Each
   * 1,000-row batch is committed to staging, then the final live-table swap is
   * deliberately tiny. Readers therefore keep the last-good guide throughout
   * a slow XMLTV refresh and a failed refresh never destroys it.
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

    db.beginTransaction()
    try {
      db.delete(LIVE_TABLE, null, null)
      db.execSQL(
        """
        INSERT INTO $LIVE_TABLE(channel_id, title, description, start_time, end_time)
        SELECT channel_id, title, description, start_time, end_time
        FROM $STAGING_TABLE
        """.trimIndent()
      )
      db.delete(STAGING_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /**
   * Window reads are the guide hot path. Filter in SQLite when channel IDs are
   * known, and skip description blobs unless a caller explicitly needs them
   * (program modal / focused-channel enrichment) so the RN bridge stays small
   * on Fire Stick-class devices.
   */
  fun queryWindow(
    startMs: Long,
    endMs: Long,
    channelIds: Collection<String>? = null,
    includeDescriptions: Boolean = true,
  ): List<NativeEpgProgram> {
    if (channelIds != null && channelIds.isEmpty()) return emptyList()

    val columns = if (includeDescriptions) {
      arrayOf("channel_id", "title", "description", "start_time", "end_time")
    } else {
      arrayOf("channel_id", "title", "start_time", "end_time")
    }

    if (channelIds == null) {
      return queryWindowChunk(columns, "end_time > ? AND start_time < ?", arrayOf(startMs.toString(), endMs.toString()), includeDescriptions)
    }

    val result = ArrayList<NativeEpgProgram>()
    val uniqueIds = channelIds.filter { it.isNotBlank() }.distinct()
    if (uniqueIds.isEmpty()) return result

    // SQLite defaults to a low bound on bound variables; chunk IN lists.
    for (chunk in uniqueIds.chunked(CHANNEL_ID_CHUNK)) {
      val placeholders = chunk.joinToString(",") { "?" }
      val args = ArrayList<String>(chunk.size + 2).apply {
        addAll(chunk)
        add(startMs.toString())
        add(endMs.toString())
      }
      result.addAll(
        queryWindowChunk(
          columns,
          "channel_id IN ($placeholders) AND end_time > ? AND start_time < ?",
          args.toTypedArray(),
          includeDescriptions,
        )
      )
    }
    return result
  }

  private fun queryWindowChunk(
    columns: Array<String>,
    selection: String,
    selectionArgs: Array<String>,
    includeDescriptions: Boolean,
  ): List<NativeEpgProgram> {
    val result = ArrayList<NativeEpgProgram>()
    readableDatabase.query(
      LIVE_TABLE,
      columns,
      selection,
      selectionArgs,
      null,
      null,
      "channel_id ASC, start_time ASC",
    ).use { cursor ->
      val channelColumn = cursor.getColumnIndexOrThrow("channel_id")
      val titleColumn = cursor.getColumnIndexOrThrow("title")
      val descriptionColumn = if (includeDescriptions) cursor.getColumnIndexOrThrow("description") else -1
      val startColumn = cursor.getColumnIndexOrThrow("start_time")
      val endColumn = cursor.getColumnIndexOrThrow("end_time")
      while (cursor.moveToNext()) {
        result.add(
          NativeEpgProgram(
            channelId = cursor.getString(channelColumn),
            title = cursor.getString(titleColumn),
            description = if (descriptionColumn >= 0 && !cursor.isNull(descriptionColumn)) {
              cursor.getString(descriptionColumn)
            } else {
              null
            },
            startMs = cursor.getLong(startColumn),
            endMs = cursor.getLong(endColumn),
          )
        )
      }
    }
    return result
  }

  fun queryCurrent(nowMs: Long): List<NativeEpgProgram> {
    val result = ArrayList<NativeEpgProgram>()
    readableDatabase.rawQuery(
      """
      SELECT channel_id, title, description, start_time, end_time
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
            startMs = cursor.getLong(3),
            endMs = cursor.getLong(4),
          )
        )
      }
    }
    return result
  }

  fun deleteExpired(beforeMs: Long) {
    writableDatabase.delete(LIVE_TABLE, "end_time < ?", arrayOf(beforeMs.toString()))
  }

  fun clear() {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(LIVE_TABLE, null, null)
      db.delete(STAGING_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun count(): Long {
    readableDatabase.rawQuery("SELECT COUNT(*) FROM $LIVE_TABLE", null).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getLong(0) else 0L
    }
  }

  companion object {
    private const val DATABASE_VERSION = 2
    private const val LIVE_TABLE = "epg_programmes"
    private const val STAGING_TABLE = "epg_programmes_staging"
    private const val CHANNEL_ID_CHUNK = 400
  }
}
