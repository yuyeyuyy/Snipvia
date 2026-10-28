#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
SOURCE="$ROOT_DIR/native/screen-capture-kit-helper/main.swift"
FRAME_SOURCE="$ROOT_DIR/native/screen-capture-kit-helper/FrozenFrameCache.swift"
BUILD_DIR="$ROOT_DIR/build/native"
MODULE_CACHE="$BUILD_DIR/module-cache"
ARM_BINARY="$BUILD_DIR/snipvia-capture-helper-arm64"
X64_BINARY="$BUILD_DIR/snipvia-capture-helper-x86_64"
UNIVERSAL_BINARY="$BUILD_DIR/snipvia-capture-helper"
DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}"
export DEVELOPER_DIR

mkdir -p "$MODULE_CACHE"
xcrun swiftc -O -parse-as-library -module-cache-path "$MODULE_CACHE" \
  -target arm64-apple-macosx14.0 \
  -framework ScreenCaptureKit -framework CoreGraphics -framework CoreVideo -framework ImageIO \
  "$SOURCE" "$FRAME_SOURCE" -o "$ARM_BINARY"
xcrun swiftc -O -parse-as-library -module-cache-path "$MODULE_CACHE" \
  -target x86_64-apple-macosx14.0 \
  -framework ScreenCaptureKit -framework CoreGraphics -framework CoreVideo -framework ImageIO \
  "$SOURCE" "$FRAME_SOURCE" -o "$X64_BINARY"
xcrun lipo -create "$ARM_BINARY" "$X64_BINARY" -output "$UNIVERSAL_BINARY"
chmod 755 "$UNIVERSAL_BINARY"
xcrun lipo -info "$UNIVERSAL_BINARY"
