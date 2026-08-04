package com.charmiptv.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class EpgNativePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(EpgNativeModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
