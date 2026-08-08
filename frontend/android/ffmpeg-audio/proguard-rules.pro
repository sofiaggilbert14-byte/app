# Keep JNI entry points and the Java callback invoked from ffmpeg_jni.cc.
-keepclasseswithmembernames class * {
    native <methods>;
}

-keep, includedescriptorclasses class androidx.media3.decoder.ffmpeg.FfmpegAudioDecoder {
  private java.nio.ByteBuffer growOutputBuffer(androidx.media3.decoder.SimpleDecoderOutputBuffer, int);
}
