package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class NativePlaybackModule(
  private val ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx), NativePlaybackManager.Listener {

  override fun getName(): String = "NativePlayback"

  init {
    NativePlaybackManager.setListener(this)
  }

  @ReactMethod
  fun prepareFullscreen(uri: String, headers: ReadableMap?, contentType: String?) {
    attachActivity()
    NativePlaybackManager.prepare(
      NativePlaybackManager.Owner.FULLSCREEN,
      uri,
      readableMapToStringMap(headers),
      contentType,
    )
  }

  @ReactMethod
  fun preparePreview(uri: String, headers: ReadableMap?, contentType: String?) {
    attachActivity()
    NativePlaybackManager.prepare(
      NativePlaybackManager.Owner.PREVIEW,
      uri,
      readableMapToStringMap(headers),
      contentType,
    )
  }

  @ReactMethod
  fun setPreviewViewport(x: Double, y: Double, width: Double, height: Double) {
    NativePlaybackManager.setPreviewViewport(x, y, width, height)
  }

  @ReactMethod
  fun setFullscreenViewport() {
    NativePlaybackManager.setFullscreenViewport()
  }

  @ReactMethod
  fun pause() {
    NativePlaybackManager.pause()
  }

  @ReactMethod
  fun resume() {
    NativePlaybackManager.resume()
  }

  @ReactMethod
  fun setMuted(muted: Boolean) {
    NativePlaybackManager.setMuted(muted)
  }

  @ReactMethod
  fun selectAudio(groupIndex: Double, trackIndex: Double) {
    NativePlaybackManager.selectAudio(groupIndex.toInt(), trackIndex.toInt(), null)
  }

  @ReactMethod
  fun selectAudioLanguage(language: String?) {
    NativePlaybackManager.selectAudio(null, null, language)
  }

  @ReactMethod
  fun selectSubtitle(groupIndex: Double, trackIndex: Double) {
    NativePlaybackManager.selectSubtitle(groupIndex.toInt(), trackIndex.toInt(), null)
  }

  @ReactMethod
  fun selectSubtitleLanguage(language: String?) {
    NativePlaybackManager.selectSubtitle(null, null, language)
  }

  @ReactMethod
  fun subtitlesOff() {
    NativePlaybackManager.selectSubtitle(null, null, null)
  }

  @ReactMethod
  fun stopPreview(promise: Promise) {
    NativePlaybackManager.stop(NativePlaybackManager.Owner.PREVIEW, releasePlayer = false) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun stopFullscreen(releasePlayer: Boolean, promise: Promise) {
    NativePlaybackManager.stop(NativePlaybackManager.Owner.FULLSCREEN, releasePlayer) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getOwner(promise: Promise) {
    promise.resolve(NativePlaybackManager.currentOwner().name.lowercase())
  }

  override fun onState(state: String, reason: String?) {
    val event = Arguments.createMap().apply {
      putString("state", state)
      if (reason != null) putString("reason", reason)
    }
    emit("NativePlaybackState", event)
  }

  override fun onTracks(
    audio: List<NativePlaybackManager.AudioTrackInfo>,
    subtitles: List<NativePlaybackManager.SubtitleTrackInfo>,
  ) {
    val audioArray = Arguments.createArray()
    audio.forEach { track ->
      audioArray.pushMap(Arguments.createMap().apply {
        putInt("groupIndex", track.groupIndex)
        putInt("trackIndex", track.trackIndex)
        putString("id", track.id)
        putString("name", track.label)
        putString("language", track.language)
        putString("mimeType", track.mimeType)
        putBoolean("isSupported", track.supported)
      })
    }
    val textArray = Arguments.createArray()
    subtitles.forEach { track ->
      textArray.pushMap(Arguments.createMap().apply {
        putInt("groupIndex", track.groupIndex)
        putInt("trackIndex", track.trackIndex)
        putString("id", track.id)
        putString("name", track.label)
        putString("language", track.language)
      })
    }
    emit("NativePlaybackTracks", Arguments.createMap().apply {
      putArray("audio", audioArray)
      putArray("text", textArray)
    })
  }

  private fun attachActivity() {
    ctx.currentActivity?.let(NativePlaybackManager::installIntoActivity)
  }

  private fun emit(name: String, value: Any) {
    try {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value)
    } catch (_: Throwable) {}
  }

  private fun readableMapToStringMap(readable: ReadableMap?): Map<String, String> {
    if (readable == null) return emptyMap()
    val out = LinkedHashMap<String, String>()
    val iterator = readable.keySetIterator()
    while (iterator.hasNextKey()) {
      val key = iterator.nextKey()
      try {
        val value = readable.getString(key)
        if (!value.isNullOrBlank()) out[key] = value
      } catch (_: Throwable) {}
    }
    return out
  }

  // Required for NativeEventEmitter.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
