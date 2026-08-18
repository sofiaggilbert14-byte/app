from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def rep(path: Path, old: str, new: str):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one anchor, found {count}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

# SQLite: built-in and user EPG share one authoritative DB but own disjoint ID namespaces.
db = ROOT / 'android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt'
rep(
    db,
    '  fun replaceBatches(batches: Sequence<List<NativeEpgProgram>>) {\n',
    '  fun replaceBatches(batches: Sequence<List<NativeEpgProgram>>) {\n    replaceNamespaceBatches(batches, userNamespace = false)\n  }\n\n  fun replaceUserBatches(batches: Sequence<List<NativeEpgProgram>>) {\n    replaceNamespaceBatches(batches, userNamespace = true)\n  }\n\n  private fun replaceNamespaceBatches(\n    batches: Sequence<List<NativeEpgProgram>>,\n    userNamespace: Boolean,\n  ) {\n',
)
rep(
    db,
    '        db.delete(LIVE_TABLE, null, null)\n        db.execSQL(\n',
    '        if (userNamespace) {\n          db.delete(LIVE_TABLE, "channel_id LIKE ?", arrayOf("${USER_EPG_PREFIX}%"))\n        } else {\n          // Built-in refresh never destroys user-owned programme rows.\n          db.delete(LIVE_TABLE, "channel_id NOT LIKE ?", arrayOf("${USER_EPG_PREFIX}%"))\n        }\n        db.execSQL(\n',
)
rep(
    db,
    '  fun queryWindow(startMs: Long, endMs: Long, channelIds: Collection<String>? = null): List<NativeEpgProgram> {\n',
    '''  fun clearBuiltInPrograms() {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(LIVE_TABLE, "channel_id NOT LIKE ?", arrayOf("${USER_EPG_PREFIX}%"))
      db.delete(STAGING_TABLE, null, null)
      rebuildProgrammeSearch(db)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun clearUserPrograms() {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete(LIVE_TABLE, "channel_id LIKE ?", arrayOf("${USER_EPG_PREFIX}%"))
      db.delete(STAGING_TABLE, null, null)
      rebuildProgrammeSearch(db)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun queryWindow(startMs: Long, endMs: Long, channelIds: Collection<String>? = null): List<NativeEpgProgram> {
''',
)
rep(
    db,
    '    private const val FTS_TABLE = "epg_programmes_fts"\n',
    '    private const val FTS_TABLE = "epg_programmes_fts"\n    private const val USER_EPG_PREFIX = "user:"\n',
)

# Native module: namespace user rows and expose inspection/import/clear methods.
mod = ROOT / 'android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt'
rep(
    mod,
    '  @ReactMethod\n  fun getWindow(startMs: Double, endMs: Double, channelIds: ReadableArray, promise: Promise) {\n',
    '''  @ReactMethod
  fun inspectUserSource(url: String, promise: Promise) {
    refreshExecutor.execute {
      try {
        val rows = Arguments.createArray()
        val validators = EpgHttpValidators()
        openPossiblyGzipped(url.trim(), validators, false).use { input ->
          val parser = Xml.newPullParser()
          parser.setInput(input, "UTF-8")
          var event = parser.eventType
          var channelId: String? = null
          var displayName: String? = null
          var count = 0
          while (event != XmlPullParser.END_DOCUMENT && count < MAX_INSPECT_CHANNELS) {
            when (event) {
              XmlPullParser.START_TAG -> when (parser.name) {
                "channel" -> {
                  channelId = parser.getAttributeValue(null, "id")?.trim()?.takeIf { it.isNotEmpty() }
                  displayName = null
                }
                "display-name" -> if (!channelId.isNullOrBlank() && displayName == null) {
                  displayName = parser.nextText().trim().ifEmpty { channelId }
                }
              }
              XmlPullParser.END_TAG -> if (parser.name == "channel") {
                val id = channelId
                if (!id.isNullOrBlank()) {
                  rows.pushMap(Arguments.createMap().apply {
                    putString("id", id)
                    putString("name", displayName ?: id)
                  })
                  count += 1
                }
                channelId = null
                displayName = null
              }
            }
            event = parser.next()
          }
        }
        promise.resolve(rows)
      } catch (t: Throwable) {
        promise.reject("USER_EPG_INSPECT_FAILED", t.message ?: "Could not inspect user XMLTV source", t)
      }
    }
  }

  @ReactMethod
  fun refreshUserSource(
    url: String,
    activeXmltvIds: ReadableArray,
    activeChannelNames: ReadableArray,
    promise: Promise,
  ) {
    val activeIds = HashSet<String>(activeXmltvIds.size())
    for (i in 0 until activeXmltvIds.size()) {
      activeXmltvIds.getString(i)?.trim()?.takeIf { it.isNotEmpty() }?.let { activeIds.add(it.lowercase()) }
    }
    val activeNames = HashSet<String>(activeChannelNames.size())
    for (i in 0 until activeChannelNames.size()) {
      activeChannelNames.getString(i)?.let(::normalizeGuideKey)?.takeIf { it.isNotEmpty() }?.let(activeNames::add)
    }
    refreshExecutor.execute {
      try {
        if (activeIds.isEmpty() && activeNames.isEmpty()) {
          database.clearUserPrograms()
          promise.resolve(Arguments.createMap().apply {
            putDouble("count", 0.0)
            putArray("channelIdsWithPrograms", Arguments.createArray())
          })
          return@execute
        }
        database.assertRefreshStorageAvailable()
        val now = System.currentTimeMillis()
        val logos = LinkedHashMap<String, String>()
        val names = LinkedHashMap<String, String>()
        val idsWithPrograms = LinkedHashSet<String>()
        val validators = EpgHttpValidators()
        val batches = streamProgramBatches(
          url.trim(),
          now - GUIDE_HISTORY_MS,
          now + GUIDE_WINDOW_MS,
          logos,
          names,
          idsWithPrograms,
          validators,
          false,
          activeIds,
          activeNames,
          0L,
          emptyMap(),
          USER_EPG_PREFIX,
        )
        database.replaceUserBatches(batches)
        val resultIds = Arguments.createArray()
        for (id in idsWithPrograms) resultIds.pushString(id)
        promise.resolve(Arguments.createMap().apply {
          putDouble("count", idsWithPrograms.size.toDouble())
          putArray("channelIdsWithPrograms", resultIds)
        })
      } catch (t: Throwable) {
        promise.reject("USER_EPG_REFRESH_FAILED", t.message ?: "Could not refresh user XMLTV source", t)
      }
    }
  }

  @ReactMethod
  fun clearBuiltInPrograms(promise: Promise) {
    refreshExecutor.execute {
      try {
        database.clearBuiltInPrograms()
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("BUILTIN_EPG_CLEAR_FAILED", t.message ?: "Could not clear built-in EPG", t)
      }
    }
  }

  @ReactMethod
  fun clearUserPrograms(promise: Promise) {
    refreshExecutor.execute {
      try {
        database.clearUserPrograms()
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("USER_EPG_CLEAR_FAILED", t.message ?: "Could not clear user EPG", t)
      }
    }
  }

  @ReactMethod
  fun getWindow(startMs: Double, endMs: Double, channelIds: ReadableArray, promise: Promise) {
''',
)
rep(
    mod,
    '    channelOffsetMs: Map<String, Long>,\n  ): Sequence<List<NativeEpgProgram>> = sequence {\n',
    '    channelOffsetMs: Map<String, Long>,\n    storagePrefix: String = "",\n  ): Sequence<List<NativeEpgProgram>> = sequence {\n',
)
rep(
    mod,
    '                    channelId = id,\n                    title = title.ifBlank { "No Information" },\n',
    '                    channelId = storagePrefix + id,\n                    title = title.ifBlank { "No Information" },\n',
)
rep(
    mod,
    '    private const val MAX_HTTP_REDIRECTS = 5\n',
    '    private const val MAX_HTTP_REDIRECTS = 5\n    private const val USER_EPG_PREFIX = "user:"\n    private const val MAX_INSPECT_CHANNELS = 25_000\n',
)

print('Phase 9 native user EPG namespaces applied')
