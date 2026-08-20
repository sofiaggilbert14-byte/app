package com.charmiptv.app

import android.content.Context
import com.bumptech.glide.Glide
import com.bumptech.glide.GlideBuilder
import com.bumptech.glide.load.engine.bitmap_recycle.LruBitmapPool
import com.bumptech.glide.load.engine.cache.InternalCacheDiskCacheFactory
import com.bumptech.glide.load.engine.cache.LruResourceCache

/** Configure Glide once before React/Expo image modules can initialize it. */
internal object CharmGlideConfig {
  fun initialize(context: Context) {
    val memory = CharmMemoryCoordinator.budgets()
    // The coordinator's logo budget is process-wide intent for decoded logo
    // memory. Split it between Glide's decoded-resource cache and reusable bitmap
    // pool instead of letting Glide independently size both from the Java heap.
    val logoBudget = memory.logoMemoryBytes.coerceAtLeast(MIN_LOGO_MEMORY_BYTES)
    val resourceBytes = (logoBudget * 3L) / 4L
    val bitmapPoolBytes = (logoBudget - resourceBytes).coerceAtLeast(1L shl 20)
    val diskBytes = if (memory.lowRam) LOW_RAM_LOGO_DISK_CACHE_BYTES else LOGO_DISK_CACHE_BYTES

    Glide.init(
      context,
      GlideBuilder()
        .setMemoryCache(LruResourceCache(resourceBytes))
        .setBitmapPool(LruBitmapPool(bitmapPoolBytes))
        .setDiskCache(
          InternalCacheDiskCacheFactory(context, "charm-channel-logos", diskBytes)
        ),
    )
  }

  private const val MIN_LOGO_MEMORY_BYTES = 4L * 1024L * 1024L
  private const val LOW_RAM_LOGO_DISK_CACHE_BYTES = 96L * 1024L * 1024L
  private const val LOGO_DISK_CACHE_BYTES = 250L * 1024L * 1024L
}
