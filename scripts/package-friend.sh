#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "$ROOT_DIR"

if [[ "${1:-}" != '--assemble-only' ]]; then
  if [[ ! -d /Applications/Xcode.app/Contents/Developer ]]; then
    print -u2 '需要完整 Xcode 才能编译应用图标和原生截图组件。'
    exit 1
  fi
  pnpm native:build
  pnpm build
  DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" pnpm exec electron-builder --mac --arm64 --publish never
fi

version="$(node -p "require('./package.json').version")"
dmg="$ROOT_DIR/dist/Snipvia-$version-arm64.dmg"
app="$ROOT_DIR/dist/mac-arm64/Snipvia.app"
share_dir="$ROOT_DIR/dist/截然-$version-Apple芯片-朋友体验包"
archive="$share_dir.zip"

[[ -f "$dmg" && -d "$app" ]] || { print -u2 '打包产物不完整。'; exit 1; }
/usr/bin/codesign --verify --deep --strict "$app"
/usr/bin/hdiutil verify "$dmg" >/dev/null

rm -rf "$share_dir"
mkdir -p "$share_dir"
/usr/bin/ditto --norsrc "$dmg" "$share_dir/${dmg:t}"
/usr/bin/ditto --norsrc "$ROOT_DIR/docs/FRIEND_INSTALL_GUIDE.md" "$share_dir/安装和使用说明.md"
(cd "$share_dir" && /usr/bin/shasum -a 256 "${dmg:t}" > SHA256.txt)
rm -f "$archive"
/usr/bin/ditto --norsrc -c -k --keepParent "$share_dir" "$archive"

print "可发送给朋友：$archive"
print "或发送安装包与说明：$share_dir"
print '此体验包仅采用临时签名，未经过 Apple 公证；首次打开方式见安装说明。'
