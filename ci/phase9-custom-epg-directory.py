from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:180]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# ---- Control DB: efficient single-row binding delete. ----
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt',
    '''  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId")\n  fun clearChannelBindings(playlistId: String)\n''',
    '''  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId")\n  fun clearChannelBindings(playlistId: String)\n\n  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId AND channelId = :channelId")\n  fun clearChannelBinding(playlistId: String, channelId: String)\n''',
)

# ---- Native EPG DB: paged lightweight XMLTV channel directory. ----
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt',
    '''internal data class PlaylistEpgMatchRow(\n  val playlistId: String,\n  val xmltvId: String,\n  val logoXmltvId: String,\n  val ambiguous: Boolean,\n  val matchPolicy: String,\n  val manual: Boolean,\n)\n''',
    '''internal data class PlaylistEpgMatchRow(\n  val playlistId: String,\n  val xmltvId: String,\n  val logoXmltvId: String,\n  val ambiguous: Boolean,\n  val matchPolicy: String,\n  val manual: Boolean,\n)\n\ninternal data class EpgAliasRow(val channelId: String, val displayName: String)\ninternal data class EpgAliasPage(val total: Int, val rows: List<EpgAliasRow>)\n''',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt',
    '''  /** Replace playlist channel rows (independent of EPG live table). */\n  fun playlistFingerprintMatches(fingerprint: String): Boolean {''',
    '''  /** Paged XMLTV channel directory. Only id/name rows cross the bridge. */\n  fun listDisplayNameAliases(query: String, offset: Int, limit: Int): EpgAliasPage {\n    val safeLimit = limit.coerceIn(1, 100)\n    val safeOffset = offset.coerceAtLeast(0)\n    val normalized = normalizeKey(query.trim())\n    val where = if (normalized.isEmpty()) "alias_kind = ?" else "alias_kind = ? AND normalized_key LIKE ?"\n    val args = if (normalized.isEmpty()) arrayOf("display_name") else arrayOf("display_name", "%$normalized%")\n    val total = readableDatabase.rawQuery(\n      "SELECT COUNT(*) FROM $ALIAS_TABLE WHERE $where",\n      args,\n    ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }\n    if (total <= 0) return EpgAliasPage(0, emptyList())\n    val rows = ArrayList<EpgAliasRow>(minOf(safeLimit, total))\n    val pageArgs = ArrayList<String>(args.size + 2).apply {\n      addAll(args)\n      add(safeLimit.toString())\n      add(safeOffset.toString())\n    }\n    readableDatabase.rawQuery(\n      "SELECT channel_id, alias_value FROM $ALIAS_TABLE WHERE $where ORDER BY alias_value COLLATE NOCASE ASC LIMIT ? OFFSET ?",\n      pageArgs.toTypedArray(),\n    ).use { cursor ->\n      while (cursor.moveToNext()) rows.add(EpgAliasRow(cursor.getString(0), cursor.getString(1)))\n    }\n    return EpgAliasPage(total, rows)\n  }\n\n  /** Replace playlist channel rows (independent of EPG live table). */\n  fun playlistFingerprintMatches(fingerprint: String): Boolean {''',
)

# ---- Native module: persist custom XMLTV channel metadata and expose paged list/single binding. ----
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '''  @ReactMethod\n  fun refreshUserGuide(url: String, promise: Promise) {''',
    '''  @ReactMethod\n  fun setGuideChannelBinding(channelId: String, xmltvId: String, promise: Promise) {\n    refreshExecutor.execute {\n      try {\n        val channel = channelId.trim()\n        val xmltv = xmltvId.trim()\n        if (channel.isEmpty()) throw IllegalArgumentException("Channel id is empty")\n        controlDao.clearChannelBinding(USER_SOURCE_ID, channel)\n        if (xmltv.isNotEmpty()) {\n          controlDao.putChannelBindings(listOf(EpgChannelBindingEntity(USER_SOURCE_ID, channel, xmltv)))\n        }\n        promise.resolve(true)\n      } catch (t: Throwable) {\n        promise.reject("EPG_BINDING_UPDATE_FAILED", t.message ?: "Could not update Guide channel assignment", t)\n      }\n    }\n  }\n\n  @ReactMethod\n  fun listUserGuideChannels(query: String, offset: Double, limit: Double, promise: Promise) {\n    queryExecutor.execute {\n      try {\n        val page = userDatabase.listDisplayNameAliases(\n          query,\n          offset.toInt().coerceAtLeast(0),\n          limit.toInt().coerceIn(1, 100),\n        )\n        val rows = Arguments.createArray()\n        for (row in page.rows) rows.pushMap(Arguments.createMap().apply {\n          putString("id", row.channelId)\n          putString("name", row.displayName)\n        })\n        promise.resolve(Arguments.createMap().apply {\n          putInt("total", page.total)\n          putArray("rows", rows)\n        })\n      } catch (t: Throwable) {\n        promise.reject("USER_EPG_DIRECTORY_FAILED", t.message ?: "Could not read custom Guide channels", t)\n      }\n    }\n  }\n\n  @ReactMethod\n  fun refreshUserGuide(url: String, promise: Promise) {''',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt',
    '''        val validators = EpgHttpValidators()\n        val batches = streamProgramBatches(\n          sourceUrl, minStop, maxStart, channelLogos, channelNames, channelIdsWithPrograms,\n          validators, false, emptySet(), emptySet(), 0L, emptyMap(), userDatabase\n        )\n        userDatabase.replaceBatches(batches)\n        userDatabase.setMeta("guide_refreshed_at", now.toString())\n''',
    '''        if (!userDatabase.ensureHealthy()) throw SQLiteException("Custom Guide database integrity check failed")\n        userDatabase.assertRefreshStorageAvailable()\n        val validators = EpgHttpValidators()\n        val batches = streamProgramBatches(\n          sourceUrl, minStop, maxStart, channelLogos, channelNames, channelIdsWithPrograms,\n          validators, false, emptySet(), emptySet(), 0L, emptyMap(), userDatabase\n        )\n        userDatabase.replaceBatches(batches)\n        val aliases = ArrayList<Triple<String, String, String>>(channelNames.size * 2)\n        for ((channelId, displayName) in channelNames) {\n          aliases.add(Triple(channelId, "display_name", displayName))\n          aliases.add(Triple(channelId, "xmltv_id", channelId))\n        }\n        for (channelId in channelIdsWithPrograms) {\n          if (!channelNames.containsKey(channelId)) aliases.add(Triple(channelId, "xmltv_id", channelId))\n        }\n        userDatabase.replaceChannelAliases(aliases)\n        userDatabase.setMeta("guide_refreshed_at", now.toString())\n''',
)

# ---- JS bridge. ----
replace(
    'frontend/src/nativeEpg.ts',
    '''  configureGuideOwnership?(primaryEnabled: boolean, userEnabled: boolean, userUrl: string, userOverrides: Record<string, string>): Promise<boolean>;\n  refreshUserGuide?(url: string): Promise<{ count: number; channelNames?: Record<string, string>; channelIdsWithPrograms?: string[] }>;\n''',
    '''  configureGuideOwnership?(primaryEnabled: boolean, userEnabled: boolean, userUrl: string, userOverrides: Record<string, string>): Promise<boolean>;\n  setGuideChannelBinding?(channelId: string, xmltvId: string): Promise<boolean>;\n  listUserGuideChannels?(query: string, offset: number, limit: number): Promise<{ total: number; rows: { id: string; name: string }[] }>;\n  refreshUserGuide?(url: string): Promise<{ count: number; channelNames?: Record<string, string>; channelIdsWithPrograms?: string[] }>;\n''',
)
replace(
    'frontend/src/nativeEpg.ts',
    '''export async function refreshNativeUserGuide(url: string): Promise<{\n  count: number;\n  channelNames?: Record<string, string>;\n  channelIdsWithPrograms?: string[];\n}> {''',
    '''export async function setNativeGuideChannelBinding(channelId: string, xmltvId: string | null): Promise<void> {\n  if (!nativeModule?.setGuideChannelBinding) return;\n  if (xmltvId?.trim()) ownershipRequiresSqlite = true;\n  if (ramModule) await ramModule.clearMemory().catch(() => undefined);\n  await nativeModule.setGuideChannelBinding(channelId, xmltvId?.trim() || "");\n}\n\nexport async function listNativeUserGuideChannels(\n  query = "",\n  offset = 0,\n  limit = 50,\n): Promise<{ total: number; rows: { id: string; name: string }[] }> {\n  if (!nativeModule?.listUserGuideChannels) return { total: 0, rows: [] };\n  return nativeModule.listUserGuideChannels(query, Math.max(0, offset), Math.max(1, Math.min(100, limit)));\n}\n\nexport async function refreshNativeUserGuide(url: string): Promise<{\n  count: number;\n  channelNames?: Record<string, string>;\n  channelIdsWithPrograms?: string[];\n}> {''',
)

print('phase9 custom EPG directory patched')
