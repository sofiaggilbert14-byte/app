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

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE epg_programmes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL
      )
      """.trimIndent()
    )
    db.execSQL(
      "CREATE INDEX idx_epg_lookup ON epg_programmes(channel_id, start_time, end_time)"
    )
    db.execSQL("CREATE INDEX idx_epg_window ON epg_programmes(start_time, end_time)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    db.execSQL("DROP TABLE IF EXISTS epg_programmes")
    onCreate(db)
  }

  fun replaceAll(programmes: Sequence<NativeEpgProgram>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete("epg_programmes", null, null)
      val statement = db.compileStatement(
        """
        INSERT INTO epg_programmes(channel_id, title, description, start_time, end_time)
        VALUES (?, ?, ?, ?, ?)
        """.trimIndent()
      )
      for (program in programmes) {
        statement.clearBindings()
        statement.bindString(1, program.channelId)
        statement.bindString(2, program.title)
        if (program.description == null) statement.bindNull(3)
        else statement.bindString(3, program.description)
        statement.bindLong(4, program.startMs)
        statement.bindLong(5, program.endMs)
        statement.executeInsert()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun replaceBatches(batches: Sequence<List<NativeEpgProgram>>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete("epg_programmes", null, null)
      val statement = db.compileStatement(
        """
        INSERT INTO epg_programmes(channel_id, title, description, start_time, end_time)
        VALUES (?, ?, ?, ?, ?)
        """.trimIndent()
      )
      for (batch in batches) {
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
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun queryWindow(startMs: Long, endMs: Long): List<NativeEpgProgram> {
    val result = ArrayList<NativeEpgProgram>()
    readableDatabase.query(
      "epg_programmes",
      arrayOf("channel_id", "title", "description", "start_time", "end_time"),
      "end_time > ? AND start_time < ?",
      arrayOf(startMs.toString(), endMs.toString()),
      null,
      null,
      "channel_id ASC, start_time ASC",
    ).use { cursor ->
      val channelColumn = cursor.getColumnIndexOrThrow("channel_id")
      val titleColumn = cursor.getColumnIndexOrThrow("title")
      val descriptionColumn = cursor.getColumnIndexOrThrow("description")
      val startColumn = cursor.getColumnIndexOrThrow("start_time")
      val endColumn = cursor.getColumnIndexOrThrow("end_time")
      while (cursor.moveToNext()) {
        result.add(
          NativeEpgProgram(
            channelId = cursor.getString(channelColumn),
            title = cursor.getString(titleColumn),
            description = if (cursor.isNull(descriptionColumn)) null else cursor.getString(descriptionColumn),
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
      FROM epg_programmes
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
    writableDatabase.delete("epg_programmes", "end_time < ?", arrayOf(beforeMs.toString()))
  }

  fun count(): Long {
    readableDatabase.rawQuery("SELECT COUNT(*) FROM epg_programmes", null).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getLong(0) else 0L
    }
  }

  companion object {
    private const val DATABASE_VERSION = 1
  }
}
