#!/bin/zsh
set -euo pipefail
ROOT_DIR="${0:A:h:h}"
BUILD_DIR="$ROOT_DIR/build/native"
SOURCE="$ROOT_DIR/native/quick-target-helper/main.swift"
export DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}"
mkdir -p "$BUILD_DIR/module-cache"
for target_arch in arm64 x86_64; do
  xcrun swiftc -O -module-cache-path "$BUILD_DIR/module-cache" -target "$target_arch-apple-macosx14.0" -framework AppKit -framework ApplicationServices -framework Carbon \
    "$SOURCE" "$ROOT_DIR/native/quick-target-helper/Browser.swift" -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$ROOT_DIR/native/quick-target-helper/Info.plist" -o "$BUILD_DIR/snipvia-quick-target-helper-$target_arch"
done
xcrun lipo -create "$BUILD_DIR/snipvia-quick-target-helper-arm64" "$BUILD_DIR/snipvia-quick-target-helper-x86_64" -output "$BUILD_DIR/snipvia-quick-target-helper"
chmod 755 "$BUILD_DIR/snipvia-quick-target-helper"
xcrun lipo -info "$BUILD_DIR/snipvia-quick-target-helper"
