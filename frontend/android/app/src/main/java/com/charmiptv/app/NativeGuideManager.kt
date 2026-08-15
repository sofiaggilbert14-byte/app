package com.charmiptv.app

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class NativeGuideManager : SimpleViewManager<NativeGuideView>() {
  override fun getName() = "CharmNativeGuide"
  override fun createViewInstance(context: ThemedReactContext) = NativeGuideView(context)

  @ReactProp(name = "channels")
  fun setChannels(view: NativeGuideView, channels: ReadableArray?) {
    val rows = ArrayList<NativeGuideView.ChannelRow>()
    if (channels != null) for (i in 0 until channels.size()) {
      val item = channels.getMap(i) ?: continue
      rows.add(NativeGuideView.ChannelRow(
        item.getString("id").orEmpty(), item.getString("name").orEmpty(),
        if (item.hasKey("number")) item.getString("number").orEmpty() else ""
      ))
    }
    view.setRows(rows)
  }

  @ReactProp(name = "windowStartMs") fun setWindowStart(view: NativeGuideView, value: Double) = view.setWindowStart(value)
  @ReactProp(name = "windowEndMs") fun setWindowEnd(view: NativeGuideView, value: Double) = view.setWindowEnd(value)
  @ReactProp(name = "active", defaultBoolean = true) fun setActive(view: NativeGuideView, value: Boolean) = view.setActive(value)

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = MapBuilder.builder<String, Any>()
    .put("topNativeGuideSelection", MapBuilder.of("registrationName", "onSelectionChange"))
    .put("topNativeGuideActivate", MapBuilder.of("registrationName", "onActivate"))
    .put("topNativeGuideBoundary", MapBuilder.of("registrationName", "onBoundary"))
    .build().toMutableMap()
}

