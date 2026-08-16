package com.charmiptv.app

import android.content.Context
import com.bumptech.glide.Glide
import com.bumptech.glide.GlideBuilder
import com.bumptech.glide.load.engine.cache.InternalCacheDiskCacheFactory

/** Configure Glide once before React/Expo image modules can initialize it. */
internal object CharmGlideConfig {
  fun initialize(context: Context) {
    Glide.init(
      context,
      GlideBuilder().setDiskCache(
        InternalCacheDiskCacheFactory(context, "charm-channel-logos", LOGO_DISK_CACHE_BYTES)
      ),
    )
  }

  private const val LOGO_DISK_CACHE_BYTES = 250L * 1024L * 1024L
}
