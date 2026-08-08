# Keep JNI entry points and the Java callback invoked from ffmpeg_jni.cc.
-keepclasseswithmembernames class * {
    native <methods>;
}

# Media3 DefaultRenderersFactory loads the extension by Class.forName + ctor.
-keep class androidx.media3.decoder.ffmpeg.FfmpegLibrary { *; }
-keep class androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer {
  <init>();
  <init>(android.os.Handler, androidx.media3.exoplayer.audio.AudioRendererEventListener, androidx.media3.common.audio.AudioProcessor[]);
  <init>(android.os.Handler, androidx.media3.exoplayer.audio.AudioRendererEventListener, androidx.media3.exoplayer.audio.AudioSink);
}

-keep, includedescriptorclasses class androidx.media3.decoder.ffmpeg.FfmpegAudioDecoder {
  private java.nio.ByteBuffer growOutputBuffer(androidx.media3.decoder.SimpleDecoderOutputBuffer, int);
}
