#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "$ROOT_DIR"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
[[ -d "$DEVELOPER_DIR" ]] || { print -u2 '需要完整 Xcode 来构建 Apple 芯片应用和图标。'; exit 1; }

if [[ "${1:-}" != '--assemble-only' ]]; then
  pnpm native:build
  pnpm build
  pnpm exec electron-builder --mac dmg --arm64 --publish never
  pnpm exec electron-builder --win nsis --x64 --publish never
fi

version="$(node -p "require('./package.json').version")"
dmg="Snipvia-$version-arm64.dmg"
exe="Snipvia-Setup-$version-x64.exe"
release_dir="$ROOT_DIR/dist/release-$version"

/usr/bin/codesign --verify --deep --strict "$ROOT_DIR/dist/mac-arm64/Snipvia.app"
/usr/bin/hdiutil verify "$ROOT_DIR/dist/$dmg" >/dev/null
[[ -f "$ROOT_DIR/dist/$exe" ]] || { print -u2 'Windows 安装器未生成。'; exit 1; }
mkdir -p "$release_dir"
/usr/bin/ditto --norsrc "$ROOT_DIR/dist/$dmg" "$release_dir/$dmg"
/usr/bin/ditto --norsrc "$ROOT_DIR/dist/$exe" "$release_dir/$exe"
cp "$ROOT_DIR/docs/FRIEND_INSTALL_GUIDE.md" "$release_dir/INSTALL-macOS-zh-CN.md"
cp "$ROOT_DIR/docs/WINDOWS_FRIEND_INSTALL_GUIDE.md" "$release_dir/INSTALL-Windows-zh-CN.md"
cp "$ROOT_DIR/docs/RELEASE_NOTES_$version.md" "$release_dir/RELEASE_NOTES-zh-CN.md"
(cd "$release_dir" && /usr/bin/shasum -a 256 "$dmg" "$exe" INSTALL-macOS-zh-CN.md INSTALL-Windows-zh-CN.md RELEASE_NOTES-zh-CN.md > SHA256SUMS.txt)
print "发布文件：$release_dir"
print 'Mac 仅 Apple 芯片；Mac 临时签名、未公证；Windows 未代码签名。'
