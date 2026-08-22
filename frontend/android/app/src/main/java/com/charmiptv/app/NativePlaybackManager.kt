package com.charmiptv.app

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.View
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Activity-owned live-TV player. React never owns the decoder or video surface.
 * One ExoPlayer instance, one SurfaceView, one OkHttp pool and one recovery timer
 * are shared for fullscreen playback for the life of the Activity.
 */
@OptIn(UnstableApi::class)
object NativePlaybackManager {
  enum class Owner { NONE, PREVIEW, FULLSCREEN }

  data class AudioTrackInfo(
    val groupIndex: Int,
    val trackIndex: Int,
    val id: String,
    val label: String,
    val language: String?,
    val mimeType: String?,
    val supported: Boolean,
  )

  data class SubtitleTrackInfo(
    val groupIndex: Int,
    val trackIndex: Int,
    val id: String,
    val label: String,
    val language: String?,
  )

  interface Listener {
    fun onState(state: String, reason: String? = null)
    fun onTracks(audio: List<AudioTrackInfo>, subtitles: List<SubtitleTrackInfo>)
  }

  private const val MIN_BUFFER_MS = 1_000
  private const val MAX_BUFFER_MS = 2_500
  private const val PLAYBACK_BUFFER_MS = 500
  private const val REBUFFER_BUFFER_MS = 1_000
  private const val TARGET_BUFFER_BYTES = 12 * 1024 * 1024
  private const val HUNG_BUFFER_REPREPARE_MS = 5_000L
  private const val STABLE_REARM_MS = 30_000L

  private val main = Handler(Looper.getMainLooper())
  private val httpClient = OkHttpClient.Builder()
    .connectionPool(ConnectionPool(6, 5, TimeUnit.MINUTES))
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .writeTimeout(15, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()

  private var activity: Activity? = null
  private var surfaceView: SurfaceView? = null
  private var shutterView: View? = null
  private var player: ExoPlayer? = null
  private var listener: Listener? = null
  private var owner: Owner = Owner.NONE
  private var activeUri: String? = null
  private var firstFrameRendered = false
  private var recoveryUsed = false
  private var stableSinceMs = 0L
  private var generation = 0L

  private val bufferingWatchdog = Runnable {
    val instance = player ?: return@Runnable
    if (!firstFrameRendered || instance.playbackState != Player.STATE_BUFFERING) return@Runnable
    val now = System.currentTimeMillis()
    if (recoveryUsed && stableSinceMs > 0L && now - stableSinceMs >= STABLE_REARM_MS) {
      recoveryUsed = false
    }
    if (recoveryUsed) {
      listener?.onState("error", "stream-error")
      return@Runnable
    }
    recoveryUsed = true
    stableSinceMs = 0L
    listener?.onState("loading", "native-reprepare")
    try {
      instance.prepare()
      instance.playWhenReady = true
    } catch (_: Throwable) {
      listener?.onState("error", "stream-error")
    }
  }

  fun setListener(next: Listener?) {
    runOnMain { listener = next }
  }

  fun installIntoActivity(activity: Activity) {
    runOnMain {
      if (this.activity === activity && surfaceView != null) return@runOnMain
      this.activity = activity
      val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return@runOnMain
      if (content.childCount == 0) {
        main.post { installIntoActivity(activity) }
        return@runOnMain
      }
      val reactRoot = content.getChildAt(0)
      content.removeView(reactRoot)
      val frame = FrameLayout(activity)
      frame.layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
      val surface = SurfaceView(activity).apply {
        setBackgroundColor(Color.BLACK)
        visibility = View.GONE
      }
      val shutter = View(activity).apply {
        setBackgroundColor(Color.BLACK)
        visibility = View.GONE
      }
      frame.addView(surface, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ))
      frame.addView(shutter, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ))
      frame.addView(reactRoot, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ))
      content.addView(frame)
      surfaceView = surface
      shutterView = shutter
      player?.setVideoSurfaceView(surface)
    }
  }

  fun prepareFullscreen(
    uri: String,
    headers: Map<String, String>,
    mimeType: String?,
  ) {
    runOnMain {
      generation += 1
      owner = Owner.FULLSCREEN
      activeUri = uri
      firstFrameRendered = false
      recoveryUsed = false
      stableSinceMs = 0L
      main.removeCallbacks(bufferingWatchdog)
      surfaceView?.visibility = View.VISIBLE
      shutterView?.visibility = View.VISIBLE
      val instance = ensurePlayer(headers)
      val itemBuilder = MediaItem.Builder().setUri(Uri.parse(uri))
      when (mimeType) {
        MimeTypes.APPLICATION_M3U8 -> itemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8)
        MimeTypes.APPLICATION_MPD -> itemBuilder.setMimeType(MimeTypes.APPLICATION_MPD)
        MimeTypes.VIDEO_MP2T -> itemBuilder.setMimeType(MimeTypes.VIDEO_MP2T)
      }
      instance.setMediaItem(itemBuilder.build(), true)
      listener?.onState("loading", null)
      instance.prepare()
      instance.playWhenReady = true
    }
  }

  fun pauseFullscreen() {
    runOnMain {
      if (owner == Owner.FULLSCREEN) player?.pause()
    }
  }

  fun resumeFullscreen() {
    runOnMain {
      if (owner == Owner.FULLSCREEN) player?.play()
    }
  }

  fun setMuted(muted: Boolean) {
    runOnMain { player?.volume = if (muted) 0f else 1f }
  }

  fun selectAudio(groupIndex: Int?, trackIndex: Int?, preferredLanguage: String?) {
    runOnMain {
      val instance = player ?: return@runOnMain
      val builder = instance.trackSelectionParameters.buildUpon()
      if (groupIndex != null && trackIndex != null) {
        val group = instance.currentTracks.groups.getOrNull(groupIndex)?.mediaTrackGroup ?: return@runOnMain
        builder.clearOverridesOfType(C.TRACK_TYPE_AUDIO)
        builder.addOverride(TrackSelectionOverride(group, trackIndex))
      } else {
        builder.clearOverridesOfType(C.TRACK_TYPE_AUDIO)
        builder.setPreferredAudioLanguage(preferredLanguage)
      }
      instance.trackSelectionParameters = builder.build()
    }
  }

  fun selectSubtitle(groupIndex: Int?, trackIndex: Int?, preferredLanguage: String?) {
    runOnMain {
      val instance = player ?: return@runOnMain
      val builder = instance.trackSelectionParameters.buildUpon()
      if (groupIndex != null && trackIndex != null) {
        val group = instance.currentTracks.groups.getOrNull(groupIndex)?.mediaTrackGroup ?: return@runOnMain
        builder.clearOverridesOfType(C.TRACK_TYPE_TEXT)
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
        builder.addOverride(TrackSelectionOverride(group, trackIndex))
      } else if (preferredLanguage.isNullOrBlank()) {
        builder.clearOverridesOfType(C.TRACK_TYPE_TEXT)
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
      } else {
        builder.clearOverridesOfType(C.TRACK_TYPE_TEXT)
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
        builder.setPreferredTextLanguage(preferredLanguage)
      }
      instance.trackSelectionParameters = builder.build()
    }
  }

  fun stopFullscreen(releasePlayer: Boolean = false, onStopped: (() -> Unit)? = null) {
    runOnMain {
      if (owner != Owner.FULLSCREEN && !releasePlayer) {
        onStopped?.invoke()
        return@runOnMain
      }
      generation += 1
      main.removeCallbacks(bufferingWatchdog)
      val instance = player
      try { instance?.stop() } catch (_: Throwable) {}
      try { instance?.clearMediaItems() } catch (_: Throwable) {}
      activeUri = null
      owner = Owner.NONE
      firstFrameRendered = false
      recoveryUsed = false
      stableSinceMs = 0L
      shutterView?.visibility = View.GONE
      surfaceView?.visibility = View.GONE
      if (releasePlayer) {
        try { instance?.clearVideoSurface() } catch (_: Throwable) {}
        try { instance?.release() } catch (_: Throwable) {}
        player = null
      }
      onStopped?.invoke()
    }
  }

  fun releaseAll() {
    stopFullscreen(releasePlayer = true)
    runOnMain {
      listener = null
      activity = null
      surfaceView = null
      shutterView = null
    }
  }

  fun currentOwner(): Owner = owner

  private fun ensurePlayer(headers: Map<String, String>): ExoPlayer {
    player?.let { existing ->
      // Headers can change per provider/channel. Rebuild only the MediaSource
      // factory around the same shared OkHttp client and same ExoPlayer owner.
      existing.setMediaSourceFactory(buildMediaSourceFactory(headers))
      return existing
    }
    val context = activity ?: throw IllegalStateException("Playback surface is not attached")
    val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(
        MIN_BUFFER_MS,
        MAX_BUFFER_MS,
        PLAYBACK_BUFFER_MS,
        REBUFFER_BUFFER_MS,
      )
      .setTargetBufferBytes(TARGET_BUFFER_BYTES)
      .setPrioritizeTimeOverSizeThresholds(true)
      .build()
    val renderers = DefaultRenderersFactory(context)
      .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
      .setEnableDecoderFallback(true)
      .forceEnableMediaCodecAsynchronousQueueing()
    return ExoPlayer.Builder(context, renderers)
      .setLoadControl(loadControl)
      .setMediaSourceFactory(buildMediaSourceFactory(headers))
      .build()
      .also { created ->
        player = created
        surfaceView?.let(created::setVideoSurfaceView)
        created.addListener(object : Player.Listener {
          override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
              Player.STATE_BUFFERING -> {
                if (firstFrameRendered) {
                  stableSinceMs = 0L
                  main.removeCallbacks(bufferingWatchdog)
                  main.postDelayed(bufferingWatchdog, HUNG_BUFFER_REPREPARE_MS)
                }
                listener?.onState("loading", null)
              }
              Player.STATE_READY -> {
                main.removeCallbacks(bufferingWatchdog)
                publishTracks(created.currentTracks)
              }
              Player.STATE_ENDED -> listener?.onState("error", "stream-ended")
              else -> Unit
            }
          }

          override fun onRenderedFirstFrame() {
            firstFrameRendered = true
            stableSinceMs = System.currentTimeMillis()
            main.removeCallbacks(bufferingWatchdog)
            shutterView?.visibility = View.GONE
            listener?.onState("playing", null)
          }

          override fun onPlayerError(error: PlaybackException) {
            main.removeCallbacks(bufferingWatchdog)
            listener?.onState("error", "media3-${error.errorCode}")
          }

          override fun onTracksChanged(tracks: Tracks) {
            publishTracks(tracks)
          }
        })
      }
  }

  private fun buildMediaSourceFactory(headers: Map<String, String>): DefaultMediaSourceFactory {
    val httpFactory = OkHttpDataSource.Factory(httpClient).apply {
      if (headers.isNotEmpty()) setDefaultRequestProperties(headers)
    }
    val dataSource = DefaultDataSource.Factory(activity ?: throw IllegalStateException("No activity"), httpFactory)
    return DefaultMediaSourceFactory(dataSource)
  }

  private fun publishTracks(tracks: Tracks) {
    val audio = ArrayList<AudioTrackInfo>()
    val subtitles = ArrayList<SubtitleTrackInfo>()
    tracks.groups.forEachIndexed { groupIndex, group ->
      for (trackIndex in 0 until group.length) {
        val format = group.getTrackFormat(trackIndex)
        val mime = format.sampleMimeType
        val id = format.id ?: "g${groupIndex}:t${trackIndex}:${mime ?: "unknown"}:${format.language ?: "und"}"
        if (group.type == C.TRACK_TYPE_AUDIO) {
          audio += AudioTrackInfo(
            groupIndex,
            trackIndex,
            id,
            format.label ?: format.language ?: "Audio ${audio.size + 1}",
            format.language,
            mime,
            group.isTrackSupported(trackIndex),
          )
        } else if (group.type == C.TRACK_TYPE_TEXT) {
          subtitles += SubtitleTrackInfo(
            groupIndex,
            trackIndex,
            id,
            format.label ?: format.language ?: "CC ${subtitles.size + 1}",
            format.language,
          )
        }
      }
    }
    listener?.onTracks(audio, subtitles)
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
