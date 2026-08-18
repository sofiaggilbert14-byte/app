package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.Executors

class CustomizationNativeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val dao = CharmCustomizationDatabase.get(reactContext).dao()
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "CharmCustomization"

  private fun cleanId(value: String?): String = value?.trim().orEmpty().take(180)
  private fun cleanName(value: String?): String = value?.replace(Regex("[\\r\\n\\t]+"), " ")
    ?.replace(Regex("\\s+"), " ")?.trim().orEmpty().take(48)

  @ReactMethod
  fun getSnapshot(promise: Promise) {
    executor.execute {
      try {
        val channelRows = dao.channelCustomizations()
        val hidden = Arguments.createArray()
        val orderPairs = channelRows
          .filter { it.customPosition != null }
          .sortedBy { it.customPosition }
        val order = Arguments.createArray()
        val numbers = Arguments.createMap()
        for (row in channelRows) {
          if (row.hidden) hidden.pushString(row.channelId)
          row.customNumber?.let { numbers.putInt(row.channelId, it) }
        }
        for (row in orderPairs) order.pushString(row.channelId)

        val mappingsByGroup = dao.allMappings().groupBy { it.groupId }
        val groups = Arguments.createArray()
        for (group in dao.groups()) {
          groups.pushMap(Arguments.createMap().apply {
            putString("id", group.id)
            putString("name", group.name)
            putInt("position", group.position)
            putArray("channelIds", Arguments.createArray().apply {
              for (mapping in mappingsByGroup[group.id].orEmpty()) pushString(mapping.channelId)
            })
          })
        }
        promise.resolve(Arguments.createMap().apply {
          putArray("hiddenIds", hidden)
          putArray("customOrder", order)
          putMap("customNumbers", numbers)
          putArray("groups", groups)
        })
      } catch (t: Throwable) {
        promise.reject("CUSTOMIZATION_SNAPSHOT_FAILED", t.message ?: "Could not read TV customization", t)
      }
    }
  }

  @ReactMethod
  fun importLegacyIfEmpty(
    hiddenIds: ReadableArray,
    customOrder: ReadableArray,
    customNumbers: ReadableMap,
    groups: ReadableArray,
    promise: Promise,
  ) {
    executor.execute {
      try {
        if (dao.channelCustomizationCount() > 0 || dao.groupCount() > 0) {
          promise.resolve(false)
          return@execute
        }
        val hidden = HashSet<String>()
        for (i in 0 until hiddenIds.size()) cleanId(hiddenIds.getString(i)).takeIf { it.isNotEmpty() }?.let(hidden::add)
        val order = ArrayList<String>()
        val seenOrder = HashSet<String>()
        for (i in 0 until customOrder.size()) {
          val id = cleanId(customOrder.getString(i))
          if (id.isNotEmpty() && seenOrder.add(id)) order.add(id)
          if (order.size >= 10_000) break
        }
        val numberMap = HashMap<String, Int>()
        val numberIterator = customNumbers.keySetIterator()
        while (numberIterator.hasNextKey() && numberMap.size < 10_000) {
          val id = cleanId(numberIterator.nextKey())
          if (id.isEmpty() || customNumbers.getType(id) != com.facebook.react.bridge.ReadableType.Number) continue
          val number = customNumbers.getDouble(id).toInt().coerceIn(1, 99_999)
          numberMap[id] = number
        }
        val allIds = LinkedHashSet<String>()
        allIds.addAll(hidden)
        allIds.addAll(order)
        allIds.addAll(numberMap.keys)
        val positionById = order.withIndex().associate { it.value to it.index }
        for (id in allIds) {
          dao.putChannelCustomization(
            UserChannelCustomizationEntity(
              channelId = id,
              hidden = hidden.contains(id),
              customPosition = positionById[id],
              customNumber = numberMap[id],
            )
          )
        }

        val usedGroupNames = HashSet<String>()
        var groupPosition = 0
        for (i in 0 until groups.size()) {
          if (groupPosition >= 32) break
          val map = groups.getMap(i) ?: continue
          val id = cleanId(map.getString("id"))
          val name = cleanName(map.getString("name"))
          val normalized = name.lowercase()
          if (id.isEmpty() || name.isEmpty() || !usedGroupNames.add(normalized)) continue
          dao.putGroup(UserCustomGroupEntity(id, name, groupPosition++))
          val ids = if (map.hasKey("channelIds")) map.getArray("channelIds") else null
          if (ids != null) {
            val rows = ArrayList<UserGroupChannelMappingEntity>()
            val seen = HashSet<String>()
            for (index in 0 until ids.size()) {
              val channelId = cleanId(ids.getString(index))
              if (channelId.isEmpty() || !seen.add(channelId)) continue
              rows.add(UserGroupChannelMappingEntity(id, channelId, rows.size))
              if (rows.size >= 10_000) break
            }
            if (rows.isNotEmpty()) dao.putMappings(rows)
          }
        }
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("CUSTOMIZATION_MIGRATION_FAILED", t.message ?: "Could not migrate TV customization", t)
      }
    }
  }

  @ReactMethod fun setHidden(channelId: String, hidden: Boolean, promise: Promise) = executor.execute {
    try { dao.setHidden(cleanId(channelId), hidden); promise.resolve(true) }
    catch (t: Throwable) { promise.reject("CUSTOMIZATION_HIDDEN_FAILED", t.message, t) }
  }

  @ReactMethod fun setCustomNumber(channelId: String, number: Double, hasNumber: Boolean, promise: Promise) = executor.execute {
    try {
      dao.setCustomNumber(cleanId(channelId), if (hasNumber) number.toInt().coerceIn(1, 99_999) else null)
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("CUSTOMIZATION_NUMBER_FAILED", t.message, t) }
  }

  @ReactMethod fun setOrder(channelIds: ReadableArray, promise: Promise) = executor.execute {
    try {
      val ids = ArrayList<String>()
      val seen = HashSet<String>()
      for (i in 0 until channelIds.size()) {
        val id = cleanId(channelIds.getString(i))
        if (id.isNotEmpty() && seen.add(id)) ids.add(id)
        if (ids.size >= 10_000) break
      }
      dao.replaceOrder(ids)
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("CUSTOMIZATION_ORDER_FAILED", t.message, t) }
  }

  @ReactMethod fun moveChannel(channelId: String, direction: Double, promise: Promise) = executor.execute {
    try { dao.moveChannel(cleanId(channelId), if (direction < 0) -1 else 1); promise.resolve(true) }
    catch (t: Throwable) { promise.reject("CUSTOMIZATION_MOVE_FAILED", t.message, t) }
  }

  @ReactMethod fun clearOrder(promise: Promise) = executor.execute {
    try { dao.clearCustomOrder(); promise.resolve(true) }
    catch (t: Throwable) { promise.reject("CUSTOMIZATION_CLEAR_ORDER_FAILED", t.message, t) }
  }

  @ReactMethod fun createGroup(groupId: String, rawName: String, promise: Promise) = executor.execute {
    try {
      val id = cleanId(groupId)
      val name = cleanName(rawName)
      if (id.isEmpty() || name.isEmpty()) throw IllegalArgumentException("Group id/name is empty")
      dao.putGroup(UserCustomGroupEntity(id, name, (dao.maxGroupPosition() ?: -1) + 1))
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("CUSTOM_GROUP_CREATE_FAILED", t.message, t) }
  }

  @ReactMethod fun renameGroup(groupId: String, rawName: String, promise: Promise) = executor.execute {
    try {
      val id = cleanId(groupId)
      val old = dao.group(id) ?: throw IllegalArgumentException("Group not found")
      val name = cleanName(rawName)
      if (name.isEmpty()) throw IllegalArgumentException("Group name is empty")
      dao.putGroup(old.copy(name = name))
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("CUSTOM_GROUP_RENAME_FAILED", t.message, t) }
  }

  @ReactMethod fun deleteGroup(groupId: String, promise: Promise) = executor.execute {
    try { dao.deleteGroup(cleanId(groupId)); promise.resolve(true) }
    catch (t: Throwable) { promise.reject("CUSTOM_GROUP_DELETE_FAILED", t.message, t) }
  }

  @ReactMethod fun moveGroup(groupId: String, direction: Double, promise: Promise) = executor.execute {
    try { dao.moveGroup(cleanId(groupId), if (direction < 0) -1 else 1); promise.resolve(true) }
    catch (t: Throwable) { promise.reject("CUSTOM_GROUP_MOVE_FAILED", t.message, t) }
  }

  @ReactMethod fun setGroupMembership(groupId: String, channelId: String, include: Boolean, promise: Promise) = executor.execute {
    try { dao.setMembership(cleanId(groupId), cleanId(channelId), include); promise.resolve(true) }
    catch (t: Throwable) { promise.reject("CUSTOM_GROUP_MEMBERSHIP_FAILED", t.message, t) }
  }
}
