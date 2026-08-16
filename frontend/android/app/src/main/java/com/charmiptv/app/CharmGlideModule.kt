package com.charmiptv.app

import android.content.Context
import com.bumptech.glide.GlideBuilder
import com.bumptech.glide.annotation.GlideModule
import com.bumptech.glide.load.engine.cache.InternalCacheDiskCacheFactory
import com.bumptech.glide.module.AppGlideModule

@GlideModule
class CharmGlideModule : AppGlideModule() {
  override fun applyOptions(context: Context, builder: GlideBuilder) {
    builder.setDiskCache(
      InternalCacheDiskCacheFactory(context, "charm-channel-logos", LOGO_DISK_CACHE_BYTES)
    )
  }

  override fun isManifestParsingEnabled(): Boolean = false

  companion object {
    private const val LOGO_DISK_CACHE_BYTES = 250L * 1024L * 1024L
  }
}
