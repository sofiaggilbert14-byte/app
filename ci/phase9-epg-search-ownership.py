from pathlib import Path

# Make native programme Search obey the same one-owner-per-channel rule as Guide.
db = Path('frontend/android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt')
s = db.read_text(encoding='utf-8')
needle = '''  fun count(): Long = countTable(LIVE_TABLE)\n\n  fun searchProgrammes(query: String, limit: Int = 80): List<NativeEpgProgram> {\n'''
insert = '''  fun count(): Long = countTable(LIVE_TABLE)\n\n  fun matchedXmltvIdsForPlaylistIds(playlistIds: Collection<String>): Set<String> {\n    if (playlistIds.isEmpty()) return emptySet()\n    val result = LinkedHashSet<String>()\n    for (chunk in playlistIds.chunked(IN_CLAUSE_CHUNK)) {\n      if (chunk.isEmpty()) continue\n      val placeholders = chunk.joinToString(",") { "?" }\n      readableDatabase.rawQuery(\n        "SELECT xmltv_id FROM $MATCH_TABLE WHERE playlist_id IN ($placeholders) AND xmltv_id != ''",\n        chunk.toTypedArray(),\n      ).use { cursor ->\n        while (cursor.moveToNext()) cursor.getString(0)?.takeIf { it.isNotBlank() }?.let(result::add)\n      }\n    }\n    return result\n  }\n\n  fun searchProgrammes(\n    query: String,\n    limit: Int = 80,\n    excludedChannelIds: Set<String> = emptySet(),\n  ): List<NativeEpgProgram> {\n'''
if needle not in s:
    raise SystemExit('guard failed: EpgDatabase search signature not found')
s = s.replace(needle, insert, 1)
old = '''        limit.coerceIn(1, 250).toString(),\n      ),\n    ).use { cursor -> appendPrograms(cursor, result) }\n    return result\n  }\n'''
new = '''        (if (excludedChannelIds.isEmpty()) limit else (limit * 3)).coerceIn(1, 250).toString(),\n      ),\n    ).use { cursor -> appendPrograms(cursor, result) }\n    if (excludedChannelIds.isEmpty()) return result.take(limit.coerceIn(1, 250))\n    return result.asSequence()\n      .filterNot { it.channelId in excludedChannelIds }\n      .take(limit.coerceIn(1, 250))\n      .toList()\n  }\n'''
if old not in s:
    raise SystemExit('guard failed: EpgDatabase search return block not found')
s = s.replace(old, new, 1)
db.write_text(s, encoding='utf-8')

module = Path('frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt')
s = module.read_text(encoding='utf-8')
old = '''        val rows = ArrayList<NativeEpgProgram>()\n        if (primaryEnabled) rows.addAll(database.searchProgrammes(query, safeLimit))\n        if (userEnabled && rows.size < safeLimit) {\n          val bindings = controlDao.allChannelBindings(USER_SOURCE_ID)\n          if (bindings.isNotEmpty()) {\n            val playlistIdsByXmltv = HashMap<String, MutableList<String>>()\n            for (binding in bindings) playlistIdsByXmltv.getOrPut(binding.xmltvId) { ArrayList() }.add(binding.channelId)\n            for (program in userDatabase.searchProgrammes(query, safeLimit - rows.size)) {\n'''
new = '''        val rows = ArrayList<NativeEpgProgram>()\n        val bindings = if (userEnabled) controlDao.allChannelBindings(USER_SOURCE_ID) else emptyList()\n        val excludedPrimaryXmltvIds = if (primaryEnabled && bindings.isNotEmpty()) {\n          database.matchedXmltvIdsForPlaylistIds(bindings.map { it.channelId })\n        } else emptySet()\n        if (primaryEnabled) {\n          rows.addAll(database.searchProgrammes(query, safeLimit, excludedPrimaryXmltvIds))\n        }\n        if (userEnabled && rows.size < safeLimit) {\n          if (bindings.isNotEmpty()) {\n            val playlistIdsByXmltv = HashMap<String, MutableList<String>>()\n            for (binding in bindings) playlistIdsByXmltv.getOrPut(binding.xmltvId) { ArrayList() }.add(binding.channelId)\n            for (program in userDatabase.searchProgrammes(query, safeLimit - rows.size)) {\n'''
if old not in s:
    raise SystemExit('guard failed: EpgNativeModule search ownership block not found')
s = s.replace(old, new, 1)
module.write_text(s, encoding='utf-8')
