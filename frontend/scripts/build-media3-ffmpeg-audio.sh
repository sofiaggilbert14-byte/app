#!/usr/bin/env bash
#
# Builds the LGPL-only audio subset of the official AndroidX Media3 FFmpeg
# extension for the Android TV APK. This deliberately does NOT enable GPL
# components. Review Dolby/DTS patent obligations before distributing builds.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE="$ROOT/android/ffmpeg-audio/src/main"
FFMPEG_DIR="$MODULE/jni/ffmpeg"
ANDROID_API="${CHARM_FFMPEG_ANDROID_API:-26}"
NDK_PATH="${ANDROID_NDK_HOME:-${ANDROID_HOME:-}/ndk/27.1.12297006}"

if [[ ! -d "$NDK_PATH" ]]; then
  echo "Android NDK not found: $NDK_PATH" >&2
  echo "Install ndk;27.1.12297006 or set ANDROID_NDK_HOME." >&2
  exit 1
fi

if [[ ! -d "$FFMPEG_DIR/.git" ]]; then
  rm -rf "$FFMPEG_DIR"
  git clone --depth 1 --branch n6.0 https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_DIR"
fi

# Keep this list deliberately narrow: common IPTV/Dolby/DTS audio plus
# widespread fallback formats. FFmpeg's default LGPL build is retained by
# never passing --enable-gpl or linking external GPL libraries.
DECODERS=(
  aac ac3 eac3 dca truehd mlp
  mp3 opus vorbis flac alac
  amrnb amrwb pcm_mulaw pcm_alaw
)

if [[ -f "$FFMPEG_DIR/android-libs/arm64-v8a/libavcodec.a" && -f "$FFMPEG_DIR/android-libs/armeabi-v7a/libavcodec.a" ]]; then
  echo "Media3 FFmpeg audio libraries already built."
  exit 0
fi

"$MODULE/jni/build_ffmpeg.sh" \
  "$MODULE" \
  "$NDK_PATH" \
  "linux-x86_64" \
  "$ANDROID_API" \
  "${DECODERS[@]}"
