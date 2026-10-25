#!/usr/bin/env bash
# Build the official Media3 1.11.1 audio extension and a small ARM64 FFmpeg.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE="${ROOT}/ffmpeg-audio/src/main"
FFSRC="${MODULE}/jni/ffmpeg"
JAVA="${MODULE}/java/androidx/media3/decoder/ffmpeg"
JNIDIR="${MODULE}/jni"
NDK_VERSION="26.1.10909125"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$SDK" ]]; then echo "ANDROID_HOME or ANDROID_SDK_ROOT must be set" >&2; exit 1; fi
NDK="${ANDROID_NDK_HOME:-${SDK}/ndk/${NDK_VERSION}}"
TOOLCHAIN="${NDK}/toolchains/llvm/prebuilt/linux-x86_64/bin"
if [[ ! -x "${TOOLCHAIN}/aarch64-linux-android23-clang" ]]; then
  echo "Android NDK r26b not installed: ${NDK}" >&2; exit 1
fi
mkdir -p "$JAVA" "$JNIDIR"
BASE="https://raw.githubusercontent.com/androidx/media/1.11.1/libraries/decoder_ffmpeg/src/main"
for name in FfmpegLibrary FfmpegAudioDecoder FfmpegAudioRenderer FfmpegDecoderException; do
  curl --fail --location --retry 3 --silent --show-error \
    "${BASE}/java/androidx/media3/decoder/ffmpeg/${name}.java" \
    --output "${JAVA}/${name}.java"
done
curl --fail --location --retry 3 --silent --show-error \
  "${BASE}/jni/ffmpeg_jni.cc" --output "${JNIDIR}/ffmpeg_jni.cc"
curl --fail --location --retry 3 --silent --show-error \
  "${BASE}/jni/CMakeLists.txt" --output "${JNIDIR}/CMakeLists.txt"

if [[ ! -d "$FFSRC/.git" ]]; then
  git clone --depth 1 --branch n6.0 https://github.com/FFmpeg/FFmpeg.git "$FFSRC"
fi

cd "$FFSRC"
echo "Compiling FFmpeg 6.0 audio-only for arm64-v8a"
./configure \
  --target-os=android \
  --arch=aarch64 --cpu=armv8-a \
  --cross-prefix="${TOOLCHAIN}/aarch64-linux-android-" \
  --cc="${TOOLCHAIN}/aarch64-linux-android23-clang" \
  --cxx="${TOOLCHAIN}/aarch64-linux-android23-clang++" \
  --nm="${TOOLCHAIN}/llvm-nm" \
  --ar="${TOOLCHAIN}/llvm-ar" \
  --ranlib="${TOOLCHAIN}/llvm-ranlib" \
  --strip="${TOOLCHAIN}/llvm-strip" \
  --libdir="android-libs/arm64-v8a" \
  --enable-cross-compile \
  --enable-static --disable-shared \
  --disable-doc --disable-programs --disable-everything \
  --disable-avdevice --disable-avformat --disable-swscale \
  --disable-postproc --disable-avfilter --disable-symver \
  --disable-v4l2-m2m --disable-vulkan \
  --enable-swresample \
  --enable-decoder=ac3 --enable-decoder=eac3 --enable-decoder=mp3 \
  --enable-small \
  --extra-ldexeflags=-pie
make -j2
make install-libs
for lib in avutil avcodec swresample; do
  test -f "android-libs/arm64-v8a/lib${lib}.a" || { echo "Missing lib${lib}.a" >&2; exit 1; }
done
echo "Audio decoder libraries ready. Video decoders were not built."
