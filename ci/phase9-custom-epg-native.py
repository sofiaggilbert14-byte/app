from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str, count=1):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:160]!r}')
    p.write_text(s.replace(old, new, count), encoding='utf-8')

# --- Room control DB: persist per-channel user EPG bindings. ---
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '@Entity(tableName = "epg_import_state")\ninternal data class EpgImportStateEntity(',
    '''@Entity(\n  tableName = "epg_channel_bindings",\n  primaryKeys = ["playlistId", "channelId"],\n  indices = [Index("playlistId"), Index("channelId")],\n)\ninternal data class EpgChannelBindingEntity(\n  val playlistId: String,\n  val channelId: String,\n  val xmltvId: String,\n)\n\n@Entity(tableName = "epg_import_state")\ninternal data class EpgImportStateEntity(''',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '  @Query("SELECT * FROM epg_import_state WHERE playlistId = :playlistId LIMIT 1")\n  fun importState(playlistId: String): EpgImportStateEntity?\n',
    '''  @Query("SELECT * FROM epg_channel_bindings WHERE playlistId = :playlistId AND channelId IN (:channelIds)")\n  fun channelBindings(playlistId: String, channelIds: List<String>): List<EpgChannelBindingEntity>\n\n  @Query("SELECT * FROM epg_channel_bindings WHERE playlistId = :playlistId")\n  fun allChannelBindings(playlistId: String): List<EpgChannelBindingEntity>\n\n  @Insert(onConflict = OnConflictStrategy.REPLACE)\n  fun putChannelBindings(bindings: List<EpgChannelBindingEntity>)\n\n  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId")\n  fun clearChannelBindings(playlistId: String)\n\n  @Query("SELECT * FROM epg_import_state WHERE playlistId = :playlistId LIMIT 1")\n  fun importState(playlistId: String): EpgImportStateEntity?\n''',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '  entities = [EpgSourceEntity::class, EpgChannelOffsetEntity::class, EpgImportStateEntity::class],\n  version = 2,',
    '  entities = [EpgSourceEntity::class, EpgChannelOffsetEntity::class, EpgChannelBindingEntity::class, EpgImportStateEntity::class],\n  version = 3,',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '      ).addMigrations(MIGRATION_1_2).build().also { instance = it }',
    '      ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { instance = it }',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '    private val MIGRATION_1_2 = object : Migration(1, 2) {',
    '    private val MIGRATION_1_2 = object : Migration(1, 2) {',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '''    private val MIGRATION_1_2 = object : Migration(1, 2) {\n      override fun migrate(db: SupportSQLiteDatabase) {''',
    '''    private val MIGRATION_1_2 = object : Migration(1, 2) {\n      override fun migrate(db: SupportSQLiteDatabase) {''',
)
# append migration before companion closing marker
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '''      }\n    }\n  }\n}\n''',
    '''      }\n    }\n\n    private val MIGRATION_2_3 = object : Migration(2, 3) {\n      override fun migrate(db: SupportSQLiteDatabase) {\n        db.execSQL(\n          "CREATE TABLE IF NOT EXISTS epg_channel_bindings (" +\n            "playlistId TEXT NOT NULL, channelId TEXT NOT NULL, xmltvId TEXT NOT NULL, " +\n            "PRIMARY KEY(playlistId, channelId))"\n        )\n        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_channel_bindings_playlistId ON epg_channel_bindings(playlistId)")\n        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_channel_bindings_channelId ON epg_channel_bindings(channelId)")\n      }\n    }\n  }\n}\n''',
)

# --- EpgDatabase can host an isolated user-guide DB with the same proven schema. ---
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt',
    'internal class EpgDatabase(context: Context) :\n  SQLiteOpenHelper(context, "charm_epg_v3.db", null, DATABASE_VERSION) {\n\n  private val appContext = context.applicationContext',
    'internal class EpgDatabase(context: Context, private val databaseName: String = "charm_epg_v3.db") :\n  SQLiteOpenHelper(context, databaseName, null, DATABASE_VERSION) {\n\n  private val appContext = context.applicationContext',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt',
    '    val dbFile = appContext.getDatabasePath("charm_epg_v3.db")',
    '    val dbFile = appContext.getDatabasePath(databaseName)',
)

# --- Native module: separate user DB, source ownership, manual bindings, composite reads. ---
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '  private val database = EpgDatabase(reactContext)\n  private val controlDao = EpgControlDatabase.get(reactContext).dao()',
    '  private val database = EpgDatabase(reactContext)\n  private val userDatabase = EpgDatabase(reactContext, "charm_epg_user_v1.db")\n  private val controlDao = EpgControlDatabase.get(reactContext).dao()',
)

# configure source ownership + bindings
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '  @ReactMethod\n  fun consumeScheduledRefreshDue(promise: Promise) {',
    '''  @ReactMethod\n  fun configureGuideOwnership(\n    primaryEnabled: Boolean,\n    userEnabled: Boolean,\n    userUrl: String,\n    userOverrides: ReadableMap,\n    promise: Promise,\n  ) {\n    refreshExecutor.execute {\n      try {\n        val now = System.currentTimeMillis() / 1000L\n        val primary = controlDao.source(DEFAULT_PLAYLIST_ID)\n        controlDao.putSource(\n          EpgSourceEntity(\n            playlistId = DEFAULT_PLAYLIST_ID,\n            url = primary?.url.orEmpty(),\n            enabled = primaryEnabled,\n            refreshHours = primary?.refreshHours ?: 12,\n            serverOffsetMinutes = primary?.serverOffsetMinutes ?: 0,\n            playlistOffsetMinutes = primary?.playlistOffsetMinutes ?: 0,\n            updatedAtSeconds = now,\n          )\n        )\n        val previousUser = controlDao.source(USER_SOURCE_ID)\n        controlDao.putSource(\n          EpgSourceEntity(\n            playlistId = USER_SOURCE_ID,\n            url = userUrl.trim(),\n            enabled = userEnabled && userUrl.trim().isNotEmpty(),\n            refreshHours = previousUser?.refreshHours ?: 12,\n            serverOffsetMinutes = previousUser?.serverOffsetMinutes ?: 0,\n            playlistOffsetMinutes = previousUser?.playlistOffsetMinutes ?: 0,\n            updatedAtSeconds = now,\n          )\n        )\n        controlDao.clearChannelBindings(USER_SOURCE_ID)\n        val bindings = ArrayList<EpgChannelBindingEntity>()\n        val iterator = userOverrides.keySetIterator()\n        while (iterator.hasNextKey()) {\n          val channelId = iterator.nextKey().trim()\n          val xmltvId = userOverrides.getString(channelId)?.trim().orEmpty()\n          if (channelId.isEmpty() || xmltvId.isEmpty()) continue\n          bindings.add(EpgChannelBindingEntity(USER_SOURCE_ID, channelId, xmltvId))\n          if (bindings.size >= MAX_USER_BINDINGS) break\n        }\n        if (bindings.isNotEmpty()) controlDao.putChannelBindings(bindings)\n        promise.resolve(true)\n      } catch (t: Throwable) {\n        promise.reject("EPG_OWNERSHIP_CONFIG_FAILED", t.message ?: "Could not save Guide ownership", t)\n      }\n    }\n  }\n\n  @ReactMethod\n  fun consumeScheduledRefreshDue(promise: Promise) {''',
)

# replace guide query with composite source selection
old_query = '''        val programmes = database.queryGuideWindow(start, end, ids)\n        promise.resolve(groupPrograms(programmes))'''
new_query = '''        val primaryEnabled = controlDao.source(DEFAULT_PLAYLIST_ID)?.enabled ?: true\n        val userSource = controlDao.source(USER_SOURCE_ID)\n        val userEnabled = userSource?.enabled == true && userSource.url.isNotBlank()\n        val bindingRows = if (userEnabled && ids.isNotEmpty()) controlDao.channelBindings(USER_SOURCE_ID, ids) else emptyList()\n        val bindingByChannel = bindingRows.associate { it.channelId to it.xmltvId }\n        val combined = ArrayList<NativeEpgProgram>()\n\n        if (primaryEnabled) {\n          val primaryIds = ids.filterNot { bindingByChannel.containsKey(it) }\n          if (primaryIds.isNotEmpty()) combined.addAll(database.queryGuideWindow(start, end, primaryIds))\n        }\n\n        if (userEnabled && bindingByChannel.isNotEmpty()) {\n          val xmltvIds = bindingByChannel.values.toSet()\n          val userRows = userDatabase.queryWindow(start, end, xmltvIds)\n          val playlistIdsByXmltv = HashMap<String, MutableList<String>>()\n          for ((playlistId, xmltvId) in bindingByChannel) {\n            playlistIdsByXmltv.getOrPut(xmltvId) { ArrayList() }.add(playlistId)\n          }\n          for (program in userRows) {\n            val playlistIds = playlistIdsByXmltv[program.channelId] ?: continue\n            for (playlistId in playlistIds) combined.add(program.copy(channelId = playlistId))\n          }\n        }\n        promise.resolve(groupPrograms(combined))'''
replace('frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt', old_query, new_query)

# search composite: only bound custom rows are exposed under playlist channel ids.
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '''        val rows = database.searchProgrammes(query, limit.toInt().coerceIn(1, 80))\n        val result = Arguments.createArray()\n        for (program in rows) result.pushMap(programToMap(program))''',
    '''        val safeLimit = limit.toInt().coerceIn(1, 80)\n        val primaryEnabled = controlDao.source(DEFAULT_PLAYLIST_ID)?.enabled ?: true\n        val userSource = controlDao.source(USER_SOURCE_ID)\n        val userEnabled = userSource?.enabled == true && userSource.url.isNotBlank()\n        val rows = ArrayList<NativeEpgProgram>()\n        if (primaryEnabled) rows.addAll(database.searchProgrammes(query, safeLimit))\n        if (userEnabled && rows.size < safeLimit) {\n          val bindings = controlDao.allChannelBindings(USER_SOURCE_ID)\n          if (bindings.isNotEmpty()) {\n            val playlistIdsByXmltv = HashMap<String, MutableList<String>>()\n            for (binding in bindings) playlistIdsByXmltv.getOrPut(binding.xmltvId) { ArrayList() }.add(binding.channelId)\n            for (program in userDatabase.searchProgrammes(query, safeLimit - rows.size)) {\n              val targets = playlistIdsByXmltv[program.channelId] ?: continue\n              for (playlistId in targets) {\n                rows.add(program.copy(channelId = playlistId))\n                if (rows.size >= safeLimit) break\n              }\n              if (rows.size >= safeLimit) break\n            }\n          }\n        }\n        val result = Arguments.createArray()\n        for (program in rows.take(safeLimit)) result.pushMap(programToMap(program))''',
)

# user EPG refresh method before clear
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '  @ReactMethod\n  fun clear(promise: Promise) {',
    '''  @ReactMethod\n  fun refreshUserGuide(url: String, promise: Promise) {\n    refreshExecutor.execute {\n      try {\n        val sourceUrl = url.trim()\n        if (sourceUrl.isEmpty()) throw IllegalArgumentException("Custom EPG URL is empty")\n        val now = System.currentTimeMillis()\n        val minStop = now - GUIDE_HISTORY_MS\n        val maxStart = now + GUIDE_WINDOW_MS\n        val channelLogos = LinkedHashMap<String, String>()\n        val channelNames = LinkedHashMap<String, String>()\n        val channelIdsWithPrograms = LinkedHashSet<String>()\n        val validators = EpgHttpValidators()\n        val batches = streamProgramBatches(\n          sourceUrl, minStop, maxStart, channelLogos, channelNames, channelIdsWithPrograms,\n          validators, false, emptySet(), emptySet(), 0L, emptyMap(), userDatabase\n        )\n        userDatabase.replaceBatches(batches)\n        userDatabase.setMeta("guide_refreshed_at", now.toString())\n        val names = Arguments.createMap()\n        for ((channelId, name) in channelNames) names.putString(channelId, name)\n        val ids = Arguments.createArray()\n        for (channelId in channelIdsWithPrograms) ids.pushString(channelId)\n        promise.resolve(Arguments.createMap().apply {\n          putDouble("count", userDatabase.count().toDouble())\n          putMap("channelNames", names)\n          putArray("channelIdsWithPrograms", ids)\n        })\n      } catch (t: Throwable) {\n        promise.reject("USER_EPG_REFRESH_FAILED", t.message ?: "Custom Guide refresh failed", t)\n      }\n    }\n  }\n\n  @ReactMethod\n  fun clear(promise: Promise) {''',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '        database.clear()\n        promise.resolve(true)',
    '        database.clear()\n        userDatabase.clear()\n        promise.resolve(true)',
)

# parser/import accepts all IDs for user source and writes into selected DB.
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '    channelOffsetMs: Map<String, Long>,\n  ): Sequence<List<NativeEpgProgram>> = sequence {\n    openPossiblyGzipped(url, httpValidators, allowNotModified).use { input ->',
    '    channelOffsetMs: Map<String, Long>,\n    targetDatabase: EpgDatabase = database,\n  ): Sequence<List<NativeEpgProgram>> = sequence {\n    openPossiblyGzipped(url, httpValidators, allowNotModified, targetDatabase).use { input ->',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '      val acceptedChannelIds = HashSet<String>(activeIds)\n',
    '      val acceptedChannelIds = HashSet<String>(activeIds)\n      val acceptAllChannels = activeIds.isEmpty() && activeNames.isEmpty()\n',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '              metadataChannelAccepted = metadataChannelId?.lowercase()?.let { it in acceptedChannelIds } == true',
    '              metadataChannelAccepted = acceptAllChannels || metadataChannelId?.lowercase()?.let { it in acceptedChannelIds } == true',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '                  if (normalizeGuideKey(displayName) in activeNames) {',
    '                  if (acceptAllChannels || normalizeGuideKey(displayName) in activeNames) {',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '                  channelId!!.lowercase() in acceptedChannelIds &&',
    '                  (acceptAllChannels || channelId!!.lowercase() in acceptedChannelIds) &&',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '    allowNotModified: Boolean,\n  ): InputStream {',
    '    allowNotModified: Boolean,\n    targetDatabase: EpgDatabase = database,\n  ): InputStream {',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '      allowNotModified && database.count() > 0L && database.getMeta(HTTP_SOURCE_HASH_KEY) == sourceHash',
    '      allowNotModified && targetDatabase.count() > 0L && targetDatabase.getMeta(HTTP_SOURCE_HASH_KEY) == sourceHash',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '        database.getMeta(HTTP_ETAG_KEY)?.takeIf { it.isNotBlank() }?.let {',
    '        targetDatabase.getMeta(HTTP_ETAG_KEY)?.takeIf { it.isNotBlank() }?.let {',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '        database.getMeta(HTTP_LAST_MODIFIED_KEY)?.takeIf { it.isNotBlank() }?.let {',
    '        targetDatabase.getMeta(HTTP_LAST_MODIFIED_KEY)?.takeIf { it.isNotBlank() }?.let {',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '      database.assertRefreshStorageAvailable(declaredLength)',
    '      targetDatabase.assertRefreshStorageAvailable(declaredLength)',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '    database.close()\n    super.invalidate()',
    '    database.close()\n    userDatabase.close()\n    super.invalidate()',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '    private const val DEFAULT_PLAYLIST_ID = "default"',
    '    private const val DEFAULT_PLAYLIST_ID = "default"\n    private const val USER_SOURCE_ID = "user"\n    private const val MAX_USER_BINDINGS = 10_000',
)

# --- JS native bridge wrappers. ---
replace(
    'frontend/src/nativeEpg.ts',
    '  clear(): Promise<boolean>;\n};',
    '''  configureGuideOwnership?(primaryEnabled: boolean, userEnabled: boolean, userUrl: string, userOverrides: Record<string, string>): Promise<boolean>;\n  refreshUserGuide?(url: string): Promise<{ count: number; channelNames?: Record<string, string>; channelIdsWithPrograms?: string[] }>;\n  clear(): Promise<boolean>;\n};''',
)
replace(
    'frontend/src/nativeEpg.ts',
    'export async function clearNativeEpg(): Promise<void> {',
    '''export async function configureNativeGuideOwnership(\n  primaryEnabled: boolean,\n  userEnabled: boolean,\n  userUrl: string,\n  userOverrides: Record<string, string>,\n): Promise<void> {\n  if (!nativeModule?.configureGuideOwnership) return;\n  await nativeModule.configureGuideOwnership(primaryEnabled, userEnabled, userUrl, userOverrides);\n}\n\nexport async function refreshNativeUserGuide(url: string): Promise<{\n  count: number;\n  channelNames?: Record<string, string>;\n  channelIdsWithPrograms?: string[];\n}> {\n  if (!nativeModule?.refreshUserGuide) throw new Error("Custom native EPG engine is unavailable");\n  return nativeModule.refreshUserGuide(url);\n}\n\nexport async function clearNativeEpg(): Promise<void> {''',
)

print('phase9 custom EPG native ownership patched')
