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
import androidx.room.Transaction

@Entity(
  tableName = "user_channel_customization",
  indices = [Index("customPosition")],
)
internal data class UserChannelCustomizationEntity(
  @PrimaryKey val channelId: String,
  val hidden: Boolean = false,
  val customPosition: Int? = null,
  val customNumber: Int? = null,
)

@Entity(
  tableName = "user_custom_groups",
  indices = [Index(value = ["name"], unique = true), Index("position")],
)
internal data class UserCustomGroupEntity(
  @PrimaryKey val id: String,
  val name: String,
  val position: Int,
)

@Entity(
  tableName = "user_group_channel_mappings",
  primaryKeys = ["groupId", "channelId"],
  indices = [Index("groupId"), Index("channelId"), Index(value = ["groupId", "position"])],
)
internal data class UserGroupChannelMappingEntity(
  val groupId: String,
  val channelId: String,
  val position: Int,
)

@Dao
internal interface CharmCustomizationDao {
  @Query("SELECT * FROM user_channel_customization")
  fun channelCustomizations(): List<UserChannelCustomizationEntity>

  @Query("SELECT * FROM user_channel_customization WHERE channelId = :channelId LIMIT 1")
  fun channelCustomization(channelId: String): UserChannelCustomizationEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putChannelCustomization(row: UserChannelCustomizationEntity)

  @Query("DELETE FROM user_channel_customization WHERE channelId = :channelId")
  fun deleteChannelCustomization(channelId: String)

  @Query("SELECT * FROM user_channel_customization WHERE customPosition IS NOT NULL ORDER BY customPosition ASC")
  fun orderedChannels(): List<UserChannelCustomizationEntity>

  @Query("SELECT * FROM user_channel_customization WHERE channelId = :channelId AND customPosition IS NOT NULL LIMIT 1")
  fun positionedChannel(channelId: String): UserChannelCustomizationEntity?

  @Query("SELECT * FROM user_channel_customization WHERE customPosition < :position ORDER BY customPosition DESC LIMIT 1")
  fun previousPositionedChannel(position: Int): UserChannelCustomizationEntity?

  @Query("SELECT * FROM user_channel_customization WHERE customPosition > :position ORDER BY customPosition ASC LIMIT 1")
  fun nextPositionedChannel(position: Int): UserChannelCustomizationEntity?

  @Query("UPDATE user_channel_customization SET customPosition = NULL")
  fun clearPositions()

  @Query("SELECT * FROM user_custom_groups ORDER BY position ASC, name COLLATE NOCASE ASC")
  fun groups(): List<UserCustomGroupEntity>

  @Query("SELECT * FROM user_custom_groups WHERE id = :groupId LIMIT 1")
  fun group(groupId: String): UserCustomGroupEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putGroup(row: UserCustomGroupEntity)

  @Query("DELETE FROM user_custom_groups WHERE id = :groupId")
  fun deleteGroupRow(groupId: String)

  @Query("SELECT MAX(position) FROM user_custom_groups")
  fun maxGroupPosition(): Int?

  @Query("SELECT * FROM user_group_channel_mappings ORDER BY groupId ASC, position ASC")
  fun allMappings(): List<UserGroupChannelMappingEntity>

  @Query("SELECT * FROM user_group_channel_mappings WHERE groupId = :groupId ORDER BY position ASC")
  fun mappings(groupId: String): List<UserGroupChannelMappingEntity>

  @Query("SELECT * FROM user_group_channel_mappings WHERE groupId = :groupId AND channelId = :channelId LIMIT 1")
  fun mapping(groupId: String, channelId: String): UserGroupChannelMappingEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putMappings(rows: List<UserGroupChannelMappingEntity>)

  @Query("DELETE FROM user_group_channel_mappings WHERE groupId = :groupId AND channelId = :channelId")
  fun deleteMapping(groupId: String, channelId: String)

  @Query("DELETE FROM user_group_channel_mappings WHERE groupId = :groupId")
  fun deleteGroupMappings(groupId: String)

  @Query("SELECT MAX(position) FROM user_group_channel_mappings WHERE groupId = :groupId")
  fun maxMappingPosition(groupId: String): Int?

  @Query("SELECT COUNT(*) FROM user_channel_customization")
  fun channelCustomizationCount(): Int

  @Query("SELECT COUNT(*) FROM user_custom_groups")
  fun groupCount(): Int

  @Transaction
  fun setHidden(channelId: String, hidden: Boolean) {
    val old = channelCustomization(channelId)
    val next = (old ?: UserChannelCustomizationEntity(channelId)).copy(hidden = hidden)
    if (!next.hidden && next.customPosition == null && next.customNumber == null) deleteChannelCustomization(channelId)
    else putChannelCustomization(next)
  }

  @Transaction
  fun setCustomNumber(channelId: String, customNumber: Int?) {
    val old = channelCustomization(channelId)
    val next = (old ?: UserChannelCustomizationEntity(channelId)).copy(customNumber = customNumber)
    if (!next.hidden && next.customPosition == null && next.customNumber == null) deleteChannelCustomization(channelId)
    else putChannelCustomization(next)
  }

  @Transaction
  fun replaceOrder(channelIds: List<String>) {
    val existing = channelCustomizations().associateBy { it.channelId }
    clearPositions()
    channelIds.forEachIndexed { index, channelId ->
      val old = existing[channelId] ?: UserChannelCustomizationEntity(channelId)
      putChannelCustomization(old.copy(customPosition = index))
    }
    // Rows that only existed for an old position should disappear after reset.
    for (row in existing.values) {
      if (row.channelId in channelIds) continue
      if (!row.hidden && row.customNumber == null) deleteChannelCustomization(row.channelId)
    }
  }

  @Transaction
  fun moveChannel(channelId: String, direction: Int) {
    val current = positionedChannel(channelId) ?: return
    val position = current.customPosition ?: return
    val neighbour = if (direction < 0)
      previousPositionedChannel(position)
    else
      nextPositionedChannel(position)
    val neighbourPosition = neighbour?.customPosition ?: return
    putChannelCustomization(current.copy(customPosition = neighbourPosition))
    putChannelCustomization(neighbour.copy(customPosition = position))
  }

  @Transaction
  fun clearCustomOrder() {
    val rows = channelCustomizations()
    clearPositions()
    for (row in rows) {
      if (!row.hidden && row.customNumber == null) deleteChannelCustomization(row.channelId)
    }
  }

  @Transaction
  fun deleteGroup(groupId: String) {
    deleteGroupMappings(groupId)
    deleteGroupRow(groupId)
  }

  @Transaction
  fun moveGroup(groupId: String, direction: Int) {
    val rows = groups()
    val from = rows.indexOfFirst { it.id == groupId }
    if (from < 0) return
    val to = (from + direction).coerceIn(0, rows.lastIndex)
    if (to == from) return
    val a = rows[from]
    val b = rows[to]
    putGroup(a.copy(position = b.position))
    putGroup(b.copy(position = a.position))
  }

  @Transaction
  fun setMembership(groupId: String, channelId: String, include: Boolean) {
    if (!include) {
      deleteMapping(groupId, channelId)
      return
    }
    if (mapping(groupId, channelId) != null) return
    val position = (maxMappingPosition(groupId) ?: -1) + 1
    putMappings(listOf(UserGroupChannelMappingEntity(groupId, channelId, position)))
  }
}

@Database(
  entities = [
    UserChannelCustomizationEntity::class,
    UserCustomGroupEntity::class,
    UserGroupChannelMappingEntity::class,
  ],
  version = 2,
  exportSchema = true,
)
internal abstract class CharmCustomizationDatabase : RoomDatabase() {
  abstract fun dao(): CharmCustomizationDao

  companion object {
    private val MIGRATION_1_2 = object : Migration(1, 2) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          "CREATE INDEX IF NOT EXISTS index_user_channel_customization_customPosition " +
            "ON user_channel_customization(customPosition)"
        )
      }
    }

    @Volatile private var instance: CharmCustomizationDatabase? = null

    fun get(context: Context): CharmCustomizationDatabase = instance ?: synchronized(this) {
      instance ?: Room.databaseBuilder(
        context.applicationContext,
        CharmCustomizationDatabase::class.java,
        "charm_user_customization_v1.db",
      )
        .addMigrations(MIGRATION_1_2)
        .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
        .build()
        .also { instance = it }
    }
  }
}
