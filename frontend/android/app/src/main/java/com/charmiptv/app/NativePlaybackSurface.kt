package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * A React Native layout target for the one authoritative Media3 PlayerView.
 * The player is reparented here for preview or fullscreen rather than being
 * placed below the whole React root, which opaque app screens would cover.
 */
class NativePlaybackSurface(context: Context) : FrameLayout(context) {
  private var owner = NativePlaybackManager.Owner.NONE

  init {
    clipChildren = true
    clipToPadding = true
  }

  fun setOwner(value: String?) {
    val next = when (value) {
      "preview" -> NativePlaybackManager.Owner.PREVIEW
      "fullscreen" -> NativePlaybackManager.Owner.FULLSCREEN
      else -> NativePlaybackManager.Owner.NONE
    }
    if (owner == next) return
    if (owner != NativePlaybackManager.Owner.NONE) NativePlaybackManager.detachSurface(owner, this)
    owner = next
    if (owner != NativePlaybackManager.Owner.NONE) NativePlaybackManager.attachSurface(owner, this)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (owner != NativePlaybackManager.Owner.NONE) NativePlaybackManager.attachSurface(owner, this)
  }

  override fun onDetachedFromWindow() {
    if (owner != NativePlaybackManager.Owner.NONE) NativePlaybackManager.detachSurface(owner, this)
    super.onDetachedFromWindow()
  }
}

class NativePlaybackSurfaceManager : SimpleViewManager<NativePlaybackSurface>() {
  override fun getName() = "CharmNativePlaybackSurface"

  override fun createViewInstance(context: ThemedReactContext) = NativePlaybackSurface(context)

  @ReactProp(name = "owner")
  fun setOwner(view: NativePlaybackSurface, value: String?) = view.setOwner(value)
}
