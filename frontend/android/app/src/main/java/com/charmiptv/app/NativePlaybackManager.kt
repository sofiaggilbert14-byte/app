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
 * Activity-owned live-TV player. React never owns Media3, MediaCodec or the
 * video Surface. One ExoPlayer instance and one SurfaceView are shared by
 * preview/fullscreen; ownership changes happen synchronously on Android's main
 * thread before the next source is prepared.
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

  // TiViMate-analysis live-TV target: 1.0s min / 2.5s max / 0.5s startup /
  // 1.0s rebuffer. Size remains a hard secondary ceiling for Fire TV-class RAM.
  private const val MIN_BUFFER_MS = 1_000
  private const val MAX_BUFFER_MS = 2_500
  private const val PLAYBACK_BUFFER_MS = 500
  private const val REBUFFER_BUFFER_MS = 1_000
  private const val TARGET_BUFFER_BYTES = 12 * 1024 * 1024

  // Exactly one native recovery timer. No JS buffering watchdog or engine swap.
  private const val HUNG_BUFFER_REPREPARE_MS = 5_000L
  private const val STABLE_REARM_MS = 30_000L
  private const val FULLSCREEN_START_TIMEOUT_MS = 12_000L
  private const val PREVIEW_START_TIMEOUT_MS = 8_000L

  private val main = Handler(Looper.getMainLooper())
  private val httpClient = OkHttpClient.Builder()
    .connectionPool(ConnectionPool(6, 5, TimeUnit.MINUTES))
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .writeTimeout(15, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()
  private val httpDataSourceFactory = OkHttpDataSource.Factory(httpClient)

  private var activity: Activity? = null
  private var playbackFrame: FrameLayout? = null
  private var surfaceView: SurfaceView? = null
  private var shutterView: View? = null
  private var player: ExoPlayer? = null
  private var listener: Listener? = null
  private var owner: Owner = Owner.NONE
  private var firstFrameRendered = false
  private var recoveryUsed = false
  private var stableSinceMs = 0L
  private var sourceGeneration = 0L

  private val startupTimeout = Runnable {
    if (owner == Owner.NONE || firstFrameRendered) return@Runnable
    listener?.onState("error", "start-timeout")
  }

  private val bufferingWatchdog = Runnable {
    val instance = player ?: return@Runnable
    if (!firstFrameRendered || instance.playbackState != Player.STATE_BUFFERING) return@Runnable
    if (recoveryUsed) {
      listener?.onState("error", "stream-error")
      return@Runnable
    }
    recoveryUsed = true
    listener?.onState("loading", "native-reprepare")
    try {
      // Re-prepare the SAME MediaItem on the SAME ExoPlayer. Do not remount a
      // React view, swap engines, or construct a second decoder.
      instance.prepare()
      instance.playWhenReady = true
    } catch (_: Throwable) {
      listener?.onState("error", "stream-error")
    }
  }

  fun setListener(next: Listener?) {
    runOnMain { listener = next }
  }

  /**
   * Installs a native video plane beneath the React root. React stays on top as
   * the OSD/Guide/control plane and never contains the SurfaceView itself.
   */
  fun installIntoActivity(activity: Activity) {
    runOnMain {
      if (this.activity === activity && playbackFrame != null) return@runOnMain
      this.activity = activity
      val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return@runOnMain
      if (content.childCount == 0) {
        main.post { installIntoActivity(activity) }
        return@runOnMain
      }
      val reactRoot = content.getChildAt(0)
      content.removeView(reactRoot)

      val frame = FrameLayout(activity).apply {
        layoutParams = FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.MATCH_PARENT,
        )
      }
      val surface = SurfaceView(activity).apply {
        setBackgroundColor(Color.BLACK)
        visibility = View.GONE
      }
      val shutter = View(activity).apply {
        setBackgroundColor(Color.BLACK)
        visibility = View.GONE
      }

      frame.addView(surface, fillParent())
      frame.addView(shutter, fillParent())
      frame.addView(reactRoot, fillParent())
      content.addView(frame)

      playbackFrame = frame
      surfaceView = surface
      shutterView = shutter
      player?.setVideoSurfaceView(surface)
    }
  }

  fun setFullscreenViewport() {
    runOnMain {
      surfaceView?.layoutParams = fillParent()
      shutterView?.layoutParams = fillParent()
      surfaceView?.requestLayout()
      shutterView?.requestLayout()
    }
  }

  /** Coordinates are density-independent React Native units. */
  fun setPreviewViewport(xDp: Double, yDp: Double, widthDp: Double, heightDp: Double) {
    runOnMain {
      val density = activity?.resources?.displayMetrics?.density ?: return@runOnMain
      val params = FrameLayout.LayoutParams(
        (widthDp * density).toInt().coerceAtLeast(1),
        (heightDp * density).toInt().coerceAtLeast(1),
      ).apply {
        leftMargin = (xDp * density).toInt().coerceAtLeast(0)
        topMargin = (yDp * density).toInt().coerceAtLeast(0)
      }
      surfaceView?.layoutParams = FrameLayout.LayoutParams(params)
      shutterView?.layoutParams = FrameLayout.LayoutParams(params)
      surfaceView?.requestLayout()
      shutterView?.requestLayout()
    }
  }

  fun prepare(
    requestedOwner: Owner,
    uri: String,
    headers: Map<String, String>,
    contentType: String?,
  ) {
    runOnMain {
      if (requestedOwner == Owner.PREVIEW && owner == Owner.FULLSCREEN) {
        // Fullscreen is authoritative. Preview cannot re-arm under it.
        return@runOnMain
      }

      val instance = ensurePlayer()
      // Stop/clear the previous owner before preparing the next source. Because
      // this runs on one Android main-thread owner there is no preview/fullscreen
      // decoder overlap and no JS decoderArmed race.
      main.removeCallbacks(startupTimeout)
      main.removeCallbacks(bufferingWatchdog)
      try { instance.stop() } catch (_: Throwable) {}
      try { instance.clearMediaItems() } catch (_: Throwable) {}

      sourceGeneration += 1
      owner = requestedOwner
      firstFrameRendered = false
      recoveryUsed = false
      stableSinceMs = 0L

      httpDataSourceFactory.setDefaultRequestProperties(headers)
      if (requestedOwner == Owner.FULLSCREEN) setFullscreenViewport()
      surfaceView?.visibility = View.VISIBLE
      shutterView?.visibility = View.VISIBLE

      val itemBuilder = MediaItem.Builder().setUri(Uri.parse(uri))
      when (contentType?.lowercase()) {
        "hls", "m3u8", MimeTypes.APPLICATION_M3U8 -> itemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8)
        "dash", "mpd", MimeTypes.APPLICATION_MPD -> itemBuilder.setMimeType(MimeTypes.APPLICATION_MPD)
        "transport", "ts", MimeTypes.VIDEO_MP2T -> itemBuilder.setMimeType(MimeTypes.VIDEO_MP2T)
      }
      instance.setMediaItem(itemBuilder.build(), true)
      listener?.onState("loading", null)
      instance.prepare()
      instance.playWhenReady = true
      main.postDelayed(
        startupTimeout,
        if (requestedOwner == Owner.PREVIEW) PREVIEW_START_TIMEOUT_MS else FULLSCREEN_START_TIMEOUT_MS,
      )
    }
  }

  fun pause() {
    runOnMain { player?.pause() }
  }

  fun resume() {
    runOnMain {
      if (owner != Owner.NONE) player?.play()
    }
  }

  fun setMuted(muted: Boolean) {
    runOnMain { player?.volume = if (muted) 0f else 1f }
  }

  fun selectAudio(groupIndex: Int?, trackIndex: Int?, preferredLanguage: String?) {
    runOnMain {
      val instance = player ?: return@runOnMain
      val builder = instance.trackSelectionParameters.buildUpon()
      builder.clearOverridesOfType(C.TRACK_TYPE_AUDIO)
      if (groupIndex != null && trackIndex != null) {
        val group = instance.currentTracks.groups.getOrNull(groupIndex)?.mediaTrackGroup ?: return@runOnMain
        builder.addOverride(TrackSelectionOverride(group, trackIndex))
      } else {
        builder.setPreferredAudioLanguage(preferredLanguage)
      }
      instance.trackSelectionParameters = builder.build()
    }
  }

  fun selectSubtitle(groupIndex: Int?, trackIndex: Int?, preferredLanguage: String?) {
    runOnMain {
      val instance = player ?: return@runOnMain
      val builder = instance.trackSelectionParameters.buildUpon()
      builder.clearOverridesOfType(C.TRACK_TYPE_TEXT)
      if (groupIndex != null && trackIndex != null) {
        val group = instance.currentTracks.groups.getOrNull(groupIndex)?.mediaTrackGroup ?: return@runOnMain
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
        builder.addOverride(TrackSelectionOverride(group, trackIndex))
      } else if (preferredLanguage.isNullOrBlank()) {
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
      } else {
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
        builder.setPreferredTextLanguage(preferredLanguage)
      }
      instance.trackSelectionParameters = builder.build()
    }
  }

  fun stop(requestedOwner: Owner, releasePlayer: Boolean = false, onStopped: (() -> Unit)? = null) {
    runOnMain {
      if (owner != requestedOwner && !releasePlayer) {
        onStopped?.invoke()
        return@runOnMain
      }
      stopInternal(releasePlayer)
      onStopped?.invoke()
    }
  }

  fun releaseAll() {
    runOnMain {
      stopInternal(releasePlayer = true)
      listener = null
      activity = null
      playbackFrame = null
      surfaceView = null
      shutterView = null
    }
  }

  fun currentOwner(): Owner = owner

  private fun stopInternal(releasePlayer: Boolean) {
    sourceGeneration += 1
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(bufferingWatchdog)
    val instance = player
    try { instance?.stop() } catch (_: Throwable) {}
    try { instance?.clearMediaItems() } catch (_: Throwable) {}
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
  }

  private fun ensurePlayer(): ExoPlayer {
    player?.let { return it }
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
    val dataSource = DefaultDataSource.Factory(context, httpDataSourceFactory)
    val mediaSourceFactory = DefaultMediaSourceFactory(dataSource)

    return ExoPlayer.Builder(context, renderers)
      .setLoadControl(loadControl)
      .setMediaSourceFactory(mediaSourceFactory)
      .build()
      .also { created ->
        player = created
        surfaceView?.let(created::setVideoSurfaceView)
        created.addListener(object : Player.Listener {
          override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
              Player.STATE_BUFFERING -> {
                if (firstFrameRendered) {
                  val now = System.currentTimeMillis()
                  if (stableSinceMs > 0L && now - stableSinceMs >= STABLE_REARM_MS) {
                    recoveryUsed = false
                  }
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
            main.removeCallbacks(startupTimeout)
            main.removeCallbacks(bufferingWatchdog)
            shutterView?.visibility = View.GONE
            listener?.onState("playing", null)
          }

          override fun onPlayerError(error: PlaybackException) {
            main.removeCallbacks(startupTimeout)
            main.removeCallbacks(bufferingWatchdog)
            listener?.onState("error", "media3-${error.errorCode}")
          }

          override fun onTracksChanged(tracks: Tracks) {
            publishTracks(tracks)
          }
        })
      }
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

  private fun fillParent() = FrameLayout.LayoutParams(
    FrameLayout.LayoutParams.MATCH_PARENT,
    FrameLayout.LayoutParams.MATCH_PARENT,
  )

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
