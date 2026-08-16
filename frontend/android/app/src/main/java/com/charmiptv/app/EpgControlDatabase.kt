package com.charmiptv.app

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Entity(tableName = "epg_sources")
internal data class EpgSourceEntity(
  @PrimaryKey val playlistId: String,
  val url: String,
  val enabled: Boolean = true,
  val refreshHours: Int = 12,
  val serverOffsetMinutes: Int = 0,
  val playlistOffsetMinutes: Int = 0,
  val updatedAtSeconds: Long,
)

@Entity(
  tableName = "epg_channel_offsets",
  primaryKeys = ["playlistId", "channelId"],
  indices = [Index("playlistId")],
)
internal data class EpgChannelOffsetEntity(
  val playlistId: String,
  val channelId: String,
  val offsetMinutes: Int,
)

@Entity(tableName = "epg_import_state")
internal data class EpgImportStateEntity(
  @PrimaryKey val playlistId: String,
  val lastAttemptSeconds: Long = 0,
  val lastSuccessSeconds: Long = 0,
  val blackoutUntilSeconds: Long = 0,
  val lastError: String = "",
)

@Dao
internal interface EpgControlDao {
  @Query("SELECT * FROM epg_sources WHERE enabled = 1 ORDER BY playlistId")
  fun enabledSources(): List<EpgSourceEntity>

  @Query("SELECT * FROM epg_sources WHERE playlistId = :playlistId LIMIT 1")
  fun source(playlistId: String): EpgSourceEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putSource(source: EpgSourceEntity)

  @Query("SELECT * FROM epg_channel_offsets WHERE playlistId = :playlistId")
  fun channelOffsets(playlistId: String): List<EpgChannelOffsetEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putChannelOffsets(offsets: List<EpgChannelOffsetEntity>)

  @Query("DELETE FROM epg_channel_offsets WHERE playlistId = :playlistId")
  fun clearChannelOffsets(playlistId: String)

  @Query("SELECT * FROM epg_import_state WHERE playlistId = :playlistId LIMIT 1")
  fun importState(playlistId: String): EpgImportStateEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putImportState(state: EpgImportStateEntity)
}

@Database(
  entities = [EpgSourceEntity::class, EpgChannelOffsetEntity::class, EpgImportStateEntity::class],
  version = 2,
  exportSchema = true,
)
internal abstract class EpgControlDatabase : RoomDatabase() {
  abstract fun dao(): EpgControlDao

  companion object {
    @Volatile private var instance: EpgControlDatabase? = null

    fun get(context: Context): EpgControlDatabase = instance ?: synchronized(this) {
      instance ?: Room.databaseBuilder(
        context.applicationContext,
        EpgControlDatabase::class.java,
        "charm_epg_control.db",
      ).addMigrations(MIGRATION_1_2).build().also { instance = it }
    }

    // Version 1 held source rows only. Version 2 adds per-channel offsets and
    // durable import/blackout state without dropping user configuration.
    private val MIGRATION_1_2 = object : Migration(1, 2) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          "CREATE TABLE IF NOT EXISTS epg_channel_offsets (" +
            "playlistId TEXT NOT NULL, channelId TEXT NOT NULL, offsetMinutes INTEGER NOT NULL, " +
            "PRIMARY KEY(playlistId, channelId))"
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_channel_offsets_playlistId ON epg_channel_offsets(playlistId)")
        db.execSQL(
          "CREATE TABLE IF NOT EXISTS epg_import_state (" +
            "playlistId TEXT NOT NULL, lastAttemptSeconds INTEGER NOT NULL, " +
            "lastSuccessSeconds INTEGER NOT NULL, blackoutUntilSeconds INTEGER NOT NULL, " +
            "lastError TEXT NOT NULL, PRIMARY KEY(playlistId))"
        )
      }
    }
  }
}
