from pathlib import Path

# 1) Make control-DB binding mutations atomic and expose a cheap binding count.
p = Path('frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt')
s = p.read_text(encoding='utf-8')
s = s.replace('import androidx.room.RoomDatabase\n', 'import androidx.room.RoomDatabase\nimport androidx.room.Transaction\n', 1)
old = '''  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId AND channelId = :channelId")\n  fun clearChannelBinding(playlistId: String, channelId: String)\n\n  @Query("SELECT * FROM epg_import_state WHERE playlistId = :playlistId LIMIT 1")\n'''
new = '''  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId AND channelId = :channelId")\n  fun clearChannelBinding(playlistId: String, channelId: String)\n\n  @Query("SELECT COUNT(*) FROM epg_channel_bindings WHERE playlistId = :playlistId")\n  fun channelBindingCount(playlistId: String): Int\n\n  @Transaction\n  fun replaceChannelBindings(playlistId: String, bindings: List<EpgChannelBindingEntity>) {\n    clearChannelBindings(playlistId)\n    if (bindings.isNotEmpty()) putChannelBindings(bindings)\n  }\n\n  @Transaction\n  fun setChannelBinding(playlistId: String, channelId: String, xmltvId: String) {\n    clearChannelBinding(playlistId, channelId)\n    if (xmltvId.isNotBlank()) {\n      putChannelBindings(listOf(EpgChannelBindingEntity(playlistId, channelId, xmltvId)))\n    }\n  }\n\n  @Query("SELECT * FROM epg_import_state WHERE playlistId = :playlistId LIMIT 1")\n'''
if old not in s:
    raise SystemExit('control DB binding insertion point not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# 2) Full ownership sync uses one transaction; individual assignment uses one row
# and returns the remaining count so JS can update RAM ownership cheaply.
p = Path('frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt')
s = p.read_text(encoding='utf-8')
old = '''        controlDao.clearChannelBindings(USER_SOURCE_ID)\n        val bindings = ArrayList<EpgChannelBindingEntity>()\n'''
new = '''        val bindings = ArrayList<EpgChannelBindingEntity>()\n'''
if old not in s:
    raise SystemExit('configure ownership clear binding block not found')
s = s.replace(old, new, 1)
old = '''        if (bindings.isNotEmpty()) controlDao.putChannelBindings(bindings)\n        promise.resolve(true)\n'''
new = '''        controlDao.replaceChannelBindings(USER_SOURCE_ID, bindings)\n        promise.resolve(true)\n'''
if old not in s:
    raise SystemExit('configure ownership binding write block not found')
s = s.replace(old, new, 1)
old = '''        controlDao.clearChannelBinding(USER_SOURCE_ID, channel)\n        if (xmltv.isNotEmpty()) {\n          controlDao.putChannelBindings(listOf(EpgChannelBindingEntity(USER_SOURCE_ID, channel, xmltv)))\n        }\n        promise.resolve(true)\n'''
new = '''        controlDao.setChannelBinding(USER_SOURCE_ID, channel, xmltv)\n        promise.resolve(controlDao.channelBindingCount(USER_SOURCE_ID))\n'''
if old not in s:
    raise SystemExit('single binding native block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# 3) Native bridge tracks ownership state after successful native writes and uses
# returned binding count to switch RAM/SQLite routing without a full-table rewrite.
p = Path('frontend/src/nativeEpg.ts')
s = p.read_text(encoding='utf-8')
s = s.replace('  setGuideChannelBinding?(channelId: string, xmltvId: string): Promise<boolean>;\n', '  setGuideChannelBinding?(channelId: string, xmltvId: string): Promise<number>;\n', 1)
s = s.replace('let ownershipRequiresSqlite = false;\n', 'let ownershipRequiresSqlite = false;\nlet primaryGuideEnabled = true;\nlet userGuideEnabled = false;\n', 1)
old = '''export async function configureNativeGuideOwnership(\n  primaryEnabled: boolean,\n  userEnabled: boolean,\n  userUrl: string,\n  userOverrides: Record<string, string>,\n): Promise<void> {\n  const hasUserBindings = userEnabled && !!userUrl.trim() && Object.keys(userOverrides).length > 0;\n  ownershipRequiresSqlite = !primaryEnabled || hasUserBindings;\n  if (ownershipRequiresSqlite && ramModule) {\n    // Primary-only RAM rows must not survive an ownership switch. SQLite remains\n    // bounded to the requested Guide runway and resolves exactly one source/channel.\n    await ramModule.clearMemory().catch(() => undefined);\n  }\n  if (!nativeModule?.configureGuideOwnership) return;\n  await nativeModule.configureGuideOwnership(primaryEnabled, userEnabled, userUrl, userOverrides);\n}\n\nexport async function setNativeGuideChannelBinding(channelId: string, xmltvId: string | null): Promise<void> {\n  if (!nativeModule?.setGuideChannelBinding) return;\n  if (xmltvId?.trim()) ownershipRequiresSqlite = true;\n  if (ramModule) await ramModule.clearMemory().catch(() => undefined);\n  await nativeModule.setGuideChannelBinding(channelId, xmltvId?.trim() || "");\n}\n'''
new = '''export async function configureNativeGuideOwnership(\n  primaryEnabled: boolean,\n  userEnabled: boolean,\n  userUrl: string,\n  userOverrides: Record<string, string>,\n): Promise<void> {\n  const effectiveUserEnabled = userEnabled && !!userUrl.trim();\n  if (nativeModule?.configureGuideOwnership) {\n    // Native ownership is authoritative. Do not flip the in-process routing flag\n    // until the durable control-DB transaction has actually succeeded.\n    await nativeModule.configureGuideOwnership(primaryEnabled, userEnabled, userUrl, userOverrides);\n  }\n  primaryGuideEnabled = primaryEnabled;\n  userGuideEnabled = effectiveUserEnabled;\n  ownershipRequiresSqlite = !primaryEnabled || (effectiveUserEnabled && Object.keys(userOverrides).length > 0);\n  if (ramModule) {\n    // Any ownership rewrite invalidates primary-only RAM joins, including the\n    // transition back to RAM after the final custom binding is cleared.\n    await ramModule.clearMemory().catch(() => undefined);\n  }\n}\n\nexport async function setNativeGuideChannelBinding(channelId: string, xmltvId: string | null): Promise<number> {\n  if (!nativeModule?.setGuideChannelBinding) return 0;\n  const count = Math.max(0, Math.round(await nativeModule.setGuideChannelBinding(channelId, xmltvId?.trim() || "")));\n  ownershipRequiresSqlite = !primaryGuideEnabled || (userGuideEnabled && count > 0);\n  if (ramModule) await ramModule.clearMemory().catch(() => undefined);\n  return count;\n}\n'''
if old not in s:
    raise SystemExit('native EPG ownership bridge block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# 4) Assignment UI performs one durable row mutation, then persists JS prefs.
p = Path('frontend/app/epg-custom.tsx')
s = p.read_text(encoding='utf-8')
old = '''      const previous = prefs.userOverrides[channel.id] || null;\n      const overrides = { ...prefs.userOverrides, [channel.id]: xmltvId };\n      await setNativeGuideChannelBinding(channel.id, xmltvId);\n      try {\n        await configureNativeGuideOwnership(\n          prefs.primaryEnabled,\n          prefs.userEnabled,\n          prefs.userUrl,\n          overrides,\n        );\n      } catch (error) {\n        await setNativeGuideChannelBinding(channel.id, previous).catch(() => undefined);\n        throw error;\n      }\n      prefs.setUserOverride(channel.id, xmltvId);\n'''
new = '''      await setNativeGuideChannelBinding(channel.id, xmltvId);\n      prefs.setUserOverride(channel.id, xmltvId);\n'''
if old not in s:
    raise SystemExit('custom EPG assign block not found')
s = s.replace(old, new, 1)
old = '''      const previous = prefs.userOverrides[channel.id] || null;\n      const overrides = { ...prefs.userOverrides };\n      delete overrides[channel.id];\n      await setNativeGuideChannelBinding(channel.id, null);\n      try {\n        await configureNativeGuideOwnership(\n          prefs.primaryEnabled,\n          prefs.userEnabled,\n          prefs.userUrl,\n          overrides,\n        );\n      } catch (error) {\n        await setNativeGuideChannelBinding(channel.id, previous).catch(() => undefined);\n        throw error;\n      }\n      prefs.setUserOverride(channel.id, null);\n'''
new = '''      await setNativeGuideChannelBinding(channel.id, null);\n      prefs.setUserOverride(channel.id, null);\n'''
if old not in s:
    raise SystemExit('custom EPG clear block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
