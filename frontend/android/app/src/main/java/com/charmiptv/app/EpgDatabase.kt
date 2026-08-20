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
  val epgLogo: String = "",
  val matchedXmltvId: String = "",
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

internal class EpgDatabase(context: Context, private val databaseName: String = "charm_epg_v3.db") :
  SQLiteOpenHelper(context, databaseName, null, DATABASE_VERSION) {

  private val appContext = context.applicationContext

  fun assertRefreshStorageAvailable(declaredCompressedBytes: Long = -1L) {
    val dbFile = appContext.getDatabasePath(databaseName)
    val currentBytes = listOf(dbFile, java.io.File(dbFile.path + "-wal"), java.io.File(dbFile.path + "-shm")).sumOf { if (it.exists()) it.length() else 0L }
    val reserve = 32L * 1024L * 1024L
    val fromCurrent = currentBytes * 2L + reserve
    val fromDownload = if (declaredCompressedBytes > 0L) declaredCompressedBytes * 6L + reserve else 0L
    val required = max(64L * 1024L * 1024L, max(fromCurrent, fromDownload))
    val available = StatFs(appContext.filesDir.absolutePath).availableBytes
    if (available < required) throw IllegalStateException("Not enough storage to update Guide (need about ${required / (1024L * 1024L)} MiB free)")
  }

  override fun onConfigure(db: SQLiteDatabase) {
    super.onConfigure(db)
    db.setForeignKeyConstraintsEnabled(false)
    runPragma(db, "PRAGMA journal_mode=WAL")
    runPragma(db, "PRAGMA synchronous=NORMAL")
    runPragma(db, "PRAGMA busy_timeout=3000")
    runPragma(db, "PRAGMA temp_store=MEMORY")
    try { runPragma(db, "PRAGMA auto_vacuum=INCREMENTAL") } catch (_: Throwable) {}
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
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_alias_kind_channel ON $ALIAS_TABLE(alias_kind, channel_id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_norm_id ON $PLAYLIST_TABLE(norm_id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_norm_name ON $PLAYLIST_TABLE(norm_name)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_active_position ON $PLAYLIST_TABLE(deleted_at, provider_position)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_deleted ON $PLAYLIST_TABLE(deleted_at)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_match_xmltv ON $MATCH_TABLE(xmltv_id)")
  }

  private fun createProgrammeTable(db: SQLiteDatabase, table: String) {
    db.execSQL("""
      CREATE TABLE IF NOT EXISTS $table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL
      )
    """.trimIndent())
  }

  private fun createAliasTable(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE IF NOT EXISTS $ALIAS_TABLE (
        channel_id TEXT NOT NULL,
        alias_kind TEXT NOT NULL,
        alias_value TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        PRIMARY KEY (alias_kind, normalized_key, channel_id)
      )
    """.trimIndent())
  }

  private fun createMetaTable(db: SQLiteDatabase) {
    db.execSQL("""CREATE TABLE IF NOT EXISTS $META_TABLE (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)""")
  }

  private fun createPlaylistTable(db: SQLiteDatabase) {
    db.execSQL("""
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
    """.trimIndent())
  }

  private fun createMatchTable(db: SQLiteDatabase) {
    db.execSQL("""
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
    """.trimIndent())
  }

  private fun createStopUpdateTable(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE IF NOT EXISTS $STOP_UPDATE_TABLE (row_id INTEGER PRIMARY KEY NOT NULL, end_time INTEGER NOT NULL)")
  }

  private fun createProgrammeSearchTable(db: SQLiteDatabase) {
    db.execSQL("CREATE VIRTUAL TABLE IF NOT EXISTS $FTS_TABLE USING fts4(programme_id INTEGER, channel_id TEXT, title TEXT, description TEXT, category TEXT)")
  }

  // Additive only: upgrades preserve LIVE/playlist/user state and add columns,
  // indexes, or derived search structures in place. Never drop last-good data.
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
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
    if (oldVersion < 5) db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_staging_order ON $STAGING_TABLE(channel_id, start_time, id)")
    if (oldVersion < 6) createStopUpdateTable(db)
    if (oldVersion < 7) {
      db.execSQL("UPDATE $LIVE_TABLE SET start_time = start_time / 1000, end_time = end_time / 1000 WHERE start_time > 100000000000")
      db.execSQL("UPDATE $STAGING_TABLE SET start_time = start_time / 1000, end_time = end_time / 1000 WHERE start_time > 100000000000")
      createProgrammeSearchTable(db)
      rebuildProgrammeSearch(db)
    }
    if (oldVersion < 8) {
      ensureColumn(db, PLAYLIST_TABLE, "deleted_at", "INTEGER NOT NULL DEFAULT 0")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_deleted ON $PLAYLIST_TABLE(deleted_at)")
    }
    if (oldVersion < 9) {
      ensureColumn(db, PLAYLIST_TABLE, "stream_url", "TEXT NOT NULL DEFAULT ''")
      ensureColumn(db, PLAYLIST_TABLE, "stream_type", "TEXT NOT NULL DEFAULT 'unknown'")
      ensureColumn(db, PLAYLIST_TABLE, "provider_position", "INTEGER NOT NULL DEFAULT 0")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_playlist_active_position ON $PLAYLIST_TABLE(deleted_at, provider_position)")
    }
    if (oldVersion < 10) db.execSQL("CREATE INDEX IF NOT EXISTS idx_epg_alias_kind_channel ON $ALIAS_TABLE(alias_kind, channel_id)")
  }

  private fun ensureColumn(db: SQLiteDatabase, table: String, column: String, type: String) {
    db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
      val nameIndex = cursor.getColumnIndex("name")
      while (cursor.moveToNext()) if (nameIndex >= 0 && cursor.getString(nameIndex) == column) return
    }
    db.execSQL("ALTER TABLE $table ADD COLUMN $column $type")
  }

  private var checkedThisProcess = false

  fun ensureHealthy(): Boolean {
    return try {
      if (!checkedThisProcess) {
        checkedThisProcess = true
        val db = readableDatabase
        db.rawQuery("PRAGMA quick_check", null).use { cursor ->
          if (!cursor.moveToFirst()) return false
          val result = cursor.getString(0) ?: ""
          if (result != "ok" && !result.equals("ok", ignoreCase = true)) return false
        }
      }
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
      val statement = db.compileStatement("INSERT INTO $table(channel_id, title, description, category, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)")
      try {
        for (program in batch) {
          statement.clearBindings()
          statement.bindString(1, program.channelId)
          statement.bindString(2, program.title)
          if (program.description == null) statement.bindNull(3) else statement.bindString(3, program.description)
          if (program.category.isNullOrBlank()) statement.bindNull(4) else statement.bindString(4, program.category)
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

  private fun countTable(table: String): Long = readableDatabase.rawQuery("SELECT COUNT(*) FROM $table", null).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }

  fun inferMissingStopsFromNextProgram(defaultDurationMs: Long, maxDurationMs: Long) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      createStopUpdateTable(db)
      db.delete(STOP_UPDATE_TABLE, null, null)
      val insertUpdate = db.compileStatement("INSERT OR REPLACE INTO $STOP_UPDATE_TABLE(row_id, end_time) VALUES (?, ?)")
      try {
        db.rawQuery("SELECT id, channel_id, start_time, end_time FROM $STAGING_TABLE ORDER BY channel_id ASC, start_time ASC, id ASC", null).use { cursor ->
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
      db.execSQL("UPDATE $STAGING_TABLE SET end_time = (SELECT end_time FROM $STOP_UPDATE_TABLE u WHERE u.row_id = $STAGING_TABLE.id) WHERE id IN (SELECT row_id FROM $STOP_UPDATE_TABLE)")
      db.delete(STOP_UPDATE_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun replaceChannelAliases(aliases: List<Triple<String, String, String>>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(ALIAS_TABLE, null, null)
      if (aliases.isNotEmpty()) {
        val statement = db.compileStatement("INSERT OR REPLACE INTO $ALIAS_TABLE(channel_id, alias_kind, alias_value, normalized_key) VALUES (?, ?, ?, ?)")
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

  fun listDisplayNameAliases(query: String, offset: Int, limit: Int): EpgAliasPage {
    val safeLimit = limit.coerceIn(1, 100)
    val safeOffset = offset.coerceAtLeast(0)
    val normalized = normalizeKey(query.trim())
    val where = if (normalized.isEmpty()) "alias_kind = ?" else "alias_kind = ? AND normalized_key LIKE ?"
    val args = if (normalized.isEmpty()) arrayOf("display_name") else arrayOf("display_name", "%$normalized%")
    val total = readableDatabase.rawQuery("SELECT COUNT(*) FROM $ALIAS_TABLE WHERE $where", args).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }
    if (total <= 0) return EpgAliasPage(0, emptyList())
    val rows = ArrayList<EpgAliasRow>(minOf(safeLimit, total))
    val pageArgs = ArrayList<String>(args.size + 2).apply { addAll(args); add(safeLimit.toString()); add(safeOffset.toString()) }
    readableDatabase.rawQuery("SELECT channel_id, alias_value FROM $ALIAS_TABLE WHERE $where ORDER BY alias_value COLLATE NOCASE ASC LIMIT ? OFFSET ?", pageArgs.toTypedArray()).use { cursor ->
      while (cursor.moveToNext()) rows.add(EpgAliasRow(cursor.getString(0), cursor.getString(1)))
    }
    return EpgAliasPage(total, rows)
  }

  fun activePlaylistChannels(): List<PlaylistChannelRow> {
    val rows = ArrayList<PlaylistChannelRow>()
    readableDatabase.rawQuery(
      "SELECT c.playlist_id, c.raw_tvg_id, c.name, COALESCE(c.logo,''), COALESCE(c.group_title,''), c.stream_url, c.stream_type, c.provider_position, COALESCE((SELECT a.alias_value FROM $ALIAS_TABLE a WHERE a.channel_id=m.xmltv_id AND a.alias_kind='icon_url' LIMIT 1),''), COALESCE(m.xmltv_id,'') FROM $PLAYLIST_TABLE c LEFT JOIN $MATCH_TABLE m ON m.playlist_id=c.playlist_id WHERE c.deleted_at=0 AND c.stream_url!='' ORDER BY provider_position ASC, name COLLATE NOCASE ASC",
      null,
    ).use { cursor ->
      while (cursor.moveToNext()) rows.add(PlaylistChannelRow(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3), cursor.getString(4), cursor.getString(5), cursor.getString(6), cursor.getInt(7), cursor.getString(8), cursor.getString(9)))
    }
    return rows
  }

  fun iconAliases(channelIds: Collection<String>): Map<String, String> {
    if (channelIds.isEmpty()) return emptyMap()
    val result = LinkedHashMap<String, String>()
    for (chunk in channelIds.chunked(IN_CLAUSE_CHUNK)) {
      val placeholders = chunk.joinToString(",") { "?" }
      val args = ArrayList<String>(chunk.size + 1)
      args.add("icon_url")
      args.addAll(chunk)
      readableDatabase.rawQuery("SELECT channel_id, alias_value FROM $ALIAS_TABLE WHERE alias_kind = ? AND channel_id IN ($placeholders)", args.toTypedArray()).use { cursor ->
        while (cursor.moveToNext()) result[cursor.getString(0)] = cursor.getString(1)
      }
    }
    return result
  }

  fun playlistFingerprintMatches(fingerprint: String): Boolean = fingerprint.isNotBlank() && getMeta(PLAYLIST_CONTENT_FINGERPRINT_KEY) == fingerprint

  @Deprecated("Use incremental PlaylistSyncCoordinator; kept only for source compatibility")
  fun replacePlaylistChannels(rows: List<PlaylistChannelRow>, playlistEpoch: Long, contentFingerprint: String): Boolean = PlaylistSyncCoordinator.sync(this, rows, playlistEpoch, contentFingerprint)

  private fun fingerprintPlaylistChannels(rows: List<PlaylistChannelRow>): String {
    val digest = MessageDigest.getInstance("SHA-256")
    fun add(value: String) { digest.update(value.toByteArray(Charsets.UTF_8)); digest.update(0.toByte()) }
    for (row in rows) { add(row.playlistId); add(row.rawTvgId); add(row.name); add(row.logo); add(row.groupTitle) }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  fun replacePlaylistEpgMatches(rows: List<PlaylistEpgMatchRow>, guideEpoch: Long): Boolean {
    val fingerprint = fingerprintPlaylistEpgMatches(rows)
    if (getMeta(MATCH_CONTENT_FINGERPRINT_KEY) == fingerprint) return false
    val db = writableDatabase
    val now = System.currentTimeMillis()
    db.beginTransaction()
    try {
      val existingManual = HashMap<String, PlaylistEpgMatchRow>()
      db.rawQuery("SELECT playlist_id,xmltv_id,logo_xmltv_id,ambiguous,match_policy,manual FROM $MATCH_TABLE WHERE manual=1", null).use { cursor ->
        while (cursor.moveToNext()) existingManual[cursor.getString(0)] = PlaylistEpgMatchRow(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getInt(3) != 0, cursor.getString(4), true)
      }
      db.delete(MATCH_TABLE, "manual=0", null)
      val statement = db.compileStatement("INSERT OR REPLACE INTO $MATCH_TABLE(playlist_id,xmltv_id,logo_xmltv_id,ambiguous,match_policy,manual,guide_epoch,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      try {
        for (row in rows) {
          val effective = existingManual[row.playlistId] ?: row
          statement.clearBindings(); statement.bindString(1, effective.playlistId); statement.bindString(2, effective.xmltvId); statement.bindString(3, effective.logoXmltvId); statement.bindLong(4, if (effective.ambiguous) 1 else 0); statement.bindString(5, effective.matchPolicy); statement.bindLong(6, if (effective.manual) 1 else 0); statement.bindLong(7, guideEpoch); statement.bindLong(8, now); statement.executeInsert()
        }
      } finally { statement.close() }
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
    setMeta(MATCH_CONTENT_FINGERPRINT_KEY, fingerprint)
    return true
  }

  fun manualMatchRows(): List<PlaylistEpgMatchRow> {
    val result = ArrayList<PlaylistEpgMatchRow>()
    readableDatabase.rawQuery("SELECT playlist_id,xmltv_id,logo_xmltv_id,ambiguous,match_policy,manual FROM $MATCH_TABLE WHERE manual=1", null).use { cursor ->
      while (cursor.moveToNext()) result.add(PlaylistEpgMatchRow(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getInt(3) != 0, cursor.getString(4), true))
    }
    return result
  }

  fun setManualPlaylistMatch(playlistId: String, xmltvId: String, logoXmltvId: String = xmltvId) {
    val cleanPlaylistId = playlistId.trim(); if (cleanPlaylistId.isEmpty()) return
    val db = writableDatabase
    if (xmltvId.isBlank()) { db.delete(MATCH_TABLE, "playlist_id=? AND manual=1", arrayOf(cleanPlaylistId)); return }
    val now = System.currentTimeMillis()
    val statement = db.compileStatement("INSERT OR REPLACE INTO $MATCH_TABLE(playlist_id,xmltv_id,logo_xmltv_id,ambiguous,match_policy,manual,guide_epoch,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    try {
      statement.bindString(1, cleanPlaylistId); statement.bindString(2, xmltvId.trim()); statement.bindString(3, logoXmltvId.trim()); statement.bindLong(4, 0); statement.bindString(5, "manual"); statement.bindLong(6, 1); statement.bindLong(7, getMeta("guide_epoch")?.toLongOrNull() ?: 0L); statement.bindLong(8, now); statement.executeInsert()
    } finally { statement.close() }
  }

  private fun fingerprintPlaylistEpgMatches(rows: List<PlaylistEpgMatchRow>): String {
    val digest = MessageDigest.getInstance("SHA-256")
    fun add(value: String) { digest.update(value.toByteArray(Charsets.UTF_8)); digest.update(0.toByte()) }
    for (row in rows) { add(row.playlistId); add(row.xmltvId); add(row.logoXmltvId); add(if (row.ambiguous) "1" else "0"); add(row.matchPolicy); add(if (row.manual) "1" else "0") }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  fun queryGuideWindow(channelIds: Collection<String>, startMs: Long, endMs: Long): List<NativeEpgProgram> {
    if (channelIds.isEmpty()) return emptyList()
    val result = ArrayList<NativeEpgProgram>()
    val startSec = toEpochSeconds(startMs)
    val endSec = toEpochSeconds(endMs)
    for (chunk in channelIds.chunked(IN_CLAUSE_CHUNK)) {
      val placeholders = chunk.joinToString(",") { "?" }
      val args = ArrayList<String>(chunk.size + 2)
      args.addAll(chunk)
      args.add(endSec.toString())
      args.add(startSec.toString())
      readableDatabase.rawQuery("SELECT channel_id,title,description,category,start_time,end_time FROM $LIVE_TABLE WHERE channel_id IN ($placeholders) AND start_time < ? AND end_time > ? ORDER BY channel_id ASC,start_time ASC", args.toTypedArray()).use { cursor ->
        while (cursor.moveToNext()) result.add(NativeEpgProgram(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3), fromEpochSeconds(cursor.getLong(4)), fromEpochSeconds(cursor.getLong(5))))
      }
    }
    return result
  }

  fun searchProgrammes(query: String, limit: Int): List<NativeEpgProgram> {
    val clean = query.trim(); if (clean.isEmpty()) return emptyList()
    val safeLimit = limit.coerceIn(1, 100)
    val tokens = clean.split(Regex("\\s+")).map { it.replace("\"", "") }.filter { it.isNotBlank() }.take(6)
    if (tokens.isEmpty()) return emptyList()
    val ftsQuery = tokens.joinToString(" ") { "\"$it\"*" }
    val rows = ArrayList<NativeEpgProgram>()
    val sql = "SELECT p.channel_id,p.title,p.description,p.category,p.start_time,p.end_time FROM $FTS_TABLE f JOIN $LIVE_TABLE p ON p.id=f.programme_id WHERE $FTS_TABLE MATCH ? ORDER BY p.start_time ASC LIMIT ?"
    readableDatabase.rawQuery(sql, arrayOf(ftsQuery, safeLimit.toString())).use { cursor ->
      while (cursor.moveToNext()) rows.add(NativeEpgProgram(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3), fromEpochSeconds(cursor.getLong(4)), fromEpochSeconds(cursor.getLong(5))))
    }
    return rows
  }

  fun replaceBatches(batches: Sequence<List<NativeEpgProgram>>) {
    val db = writableDatabase
    db.delete(STAGING_TABLE, null, null)
    var inserted = 0L
    try {
      for (batch in batches) {
        insertBatch(db, STAGING_TABLE, batch)
        inserted += batch.size
      }
      if (inserted <= 0L) throw IllegalStateException("Refusing to replace live EPG with an empty feed")
      inferMissingStopsFromNextProgram(DEFAULT_PROGRAMME_DURATION_MS, MAX_PROGRAMME_DURATION_MS)
      db.beginTransaction()
      try {
        db.delete(LIVE_TABLE, null, null)
        db.execSQL("INSERT INTO $LIVE_TABLE(channel_id,title,description,category,start_time,end_time) SELECT channel_id,title,description,category,start_time,end_time FROM $STAGING_TABLE")
        db.delete(STAGING_TABLE, null, null)
        rebuildProgrammeSearch(db)
        db.setTransactionSuccessful()
      } finally { db.endTransaction() }
    } catch (t: Throwable) {
      try { db.delete(STAGING_TABLE, null, null) } catch (_: Throwable) {}
      throw t
    }
  }

  fun discardStaging() { try { writableDatabase.delete(STAGING_TABLE, null, null) } catch (_: Throwable) {} }

  fun count(): Long = countTable(LIVE_TABLE)
  fun clear() {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(LIVE_TABLE, null, null); db.delete(STAGING_TABLE, null, null); db.delete(ALIAS_TABLE, null, null); db.delete(FTS_TABLE, null, null)
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }

  fun setMeta(key: String, value: String) {
    val statement = writableDatabase.compileStatement("INSERT OR REPLACE INTO $META_TABLE(key,value) VALUES (?,?)")
    try { statement.bindString(1, key); statement.bindString(2, value); statement.executeInsert() } finally { statement.close() }
  }

  fun getMeta(key: String): String? = readableDatabase.rawQuery("SELECT value FROM $META_TABLE WHERE key=? LIMIT 1", arrayOf(key)).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

  fun maybeIncrementalVacuum(deletedRows: Long) {
    if (deletedRows < MIN_VACUUM_DELETED_ROWS) return
    try { runPragma(writableDatabase, "PRAGMA wal_checkpoint(PASSIVE)") } catch (_: Throwable) {}
    try { runPragma(writableDatabase, "PRAGMA incremental_vacuum(64)") } catch (_: Throwable) {}
  }

  private fun rebuildProgrammeSearch(db: SQLiteDatabase) {
    createProgrammeSearchTable(db)
    db.delete(FTS_TABLE, null, null)
    db.execSQL("INSERT INTO $FTS_TABLE(programme_id,channel_id,title,description,category) SELECT id,channel_id,title,COALESCE(description,''),COALESCE(category,'') FROM $LIVE_TABLE")
  }

  private fun runPragma(db: SQLiteDatabase, sql: String) { db.rawQuery(sql, null).use { cursor -> while (cursor.moveToNext()) Unit } }
  private fun normalizeKey(value: String): String = value.lowercase(Locale.US).replace(Regex("[^a-z0-9]+"), " ").trim().replace(Regex("\\s+"), " ")
  private fun toEpochSeconds(valueMs: Long): Long = valueMs / 1000L
  private fun fromEpochSeconds(valueSec: Long): Long = valueSec * 1000L
  private fun toDurationSeconds(valueMs: Long): Long = valueMs / 1000L

  companion object {
    private const val DATABASE_VERSION = 10
    private const val LIVE_TABLE = "epg_programmes"
    private const val STAGING_TABLE = "epg_programmes_staging"
    private const val ALIAS_TABLE = "epg_channel_aliases"
    private const val META_TABLE = "epg_meta"
    private const val PLAYLIST_TABLE = "playlist_channels"
    private const val MATCH_TABLE = "playlist_epg_matches"
    private const val STOP_UPDATE_TABLE = "epg_stop_updates"
    private const val FTS_TABLE = "epg_programmes_fts"
    private const val IN_CLAUSE_CHUNK = 700
    private const val DEFAULT_PROGRAMME_DURATION_MS = 30L * 60L * 1000L
    private const val MAX_PROGRAMME_DURATION_MS = 8L * 60L * 60L * 1000L
    private const val MIN_VACUUM_DELETED_ROWS = 50_000L
    private const val PLAYLIST_CONTENT_FINGERPRINT_KEY = "playlist_content_fingerprint"
    private const val MATCH_CONTENT_FINGERPRINT_KEY = "playlist_match_fingerprint"
  }
}
