#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "$ROOT_DIR"

if [[ "${1:-}" != '--assemble-only' ]]; then
  pnpm build
  pnpm exec electron-builder --win --x64 --dir --publish never
fi

version="$(node -p "require('./package.json').version")"
app_dir="$ROOT_DIR/dist/win-unpacked"
share_dir="$ROOT_DIR/dist/Snipvia-$version-Windows-x64-Preview-r5"
archive="$share_dir.zip"

[[ -f "$app_dir/Snipvia.exe" && -f "$app_dir/resources/app.asar" ]] || {
  print -u2 'Windows x64 应用目录不完整。'
  exit 1
}

rm -rf "$share_dir"
mkdir -p "$share_dir/Snipvia"
/usr/bin/ditto --norsrc "$app_dir" "$share_dir/Snipvia"
/usr/bin/ditto --norsrc "$ROOT_DIR/docs/WINDOWS_FRIEND_INSTALL_GUIDE.md" "$share_dir/README-zh-CN.txt"
(cd "$share_dir" && /usr/bin/shasum -a 256 Snipvia/Snipvia.exe Snipvia/resources/app.asar > SHA256.txt)
rm -f "$archive"
/usr/bin/ditto --norsrc -c -k --keepParent "$share_dir" "$archive"

print "Windows 免安装体验包：$archive"
print '这是 macOS 交叉构建产物；仍需在真实 Windows 11 x64 电脑上确认运行、截图与系统兼容性。'
