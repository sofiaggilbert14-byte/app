package com.charmiptv.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp

class NativeGuideManager : SimpleViewManager<NativeGuideView>() {
  override fun getName() = "CharmNativeGuide"
  override fun createViewInstance(context: ThemedReactContext) = NativeGuideView(context)
  @ReactProp(name = "channels") fun channels(view: NativeGuideView, value: com.facebook.react.bridge.ReadableArray?) = view.setChannels(value)
  @ReactProp(name = "windowStartMs") fun start(view: NativeGuideView, value: Double) = view.setWindowStart(value)
  @ReactProp(name = "windowEndMs") fun end(view: NativeGuideView, value: Double) = view.setWindowEnd(value)
  @ReactProp(name = "active", defaultBoolean = true) fun active(view: NativeGuideView, value: Boolean) = view.setActive(value)
  @ReactProp(name = "restoreChannelId") fun restore(view: NativeGuideView, value: String?) = view.restoreChannel(value)
  override fun onDropViewInstance(view: NativeGuideView) {
    view.dispose()
    super.onDropViewInstance(view)
  }
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = MapBuilder.builder<String, Any>()
    .put("selectionChange", MapBuilder.of("registrationName", "onSelectionChange"))
    .put("runwayChange", MapBuilder.of("registrationName", "onRunwayChange"))
    .put("topLeftBoundary", MapBuilder.of("registrationName", "onLeftBoundary"))
    .put("upBoundary", MapBuilder.of("registrationName", "onUpBoundary"))
    .build().toMutableMap()
}

class NativeGuidePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = emptyList()
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(NativeGuideManager())
}
