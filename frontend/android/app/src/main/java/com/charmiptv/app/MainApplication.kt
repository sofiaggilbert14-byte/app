package com.charmiptv.app

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.modules.core.DeviceEventManagerModule

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(TvRemotePackage())
              add(EpgNativePackage())
              add(EpgRamPackage())
              add(NativeGuidePackage())
              add(CustomizationNativePackage())
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    CharmMemoryCoordinator.initialize(this)
    CharmGlideConfig.initialize(this)
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
    EpgUpdateScheduler.install(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    val trimLevel = when {
      level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
        level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> CharmTrimLevel.CRITICAL
      level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> CharmTrimLevel.MODERATE
      level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> CharmTrimLevel.BACKGROUND
      else -> null
    } ?: return
    CharmMemoryCoordinator.trim(trimLevel)
    val pressure = trimLevel.name.lowercase()
    try {
      reactNativeHost.reactInstanceManager.currentReactContext
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("CharmMemoryPressure", pressure)
    } catch (_: Throwable) {
      // Memory cleanup is best-effort; Android may call before React is ready.
    }
  }
}
