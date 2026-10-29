#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
PREPARE_ONLY=false
if [[ "${1:-}" == "--prepare" ]]; then PREPARE_ONLY=true; fi
SOURCE_EXECUTABLE="$(cd "$ROOT_DIR" && node -p "require('electron')")"
SOURCE_APP="${SOURCE_EXECUTABLE:h:h:h}"
APPLICATIONS_DIR="${SNIPVIA_DEV_APPLICATIONS_DIR:-$HOME/Applications}"
TARGET_APP="$APPLICATIONS_DIR/截然 Dev.app"
RUNTIME_DIR="$ROOT_DIR/.dev-runtime"
RUNTIME_APP="$RUNTIME_DIR/Electron.app"

if [[ ! -d "$SOURCE_APP" ]]; then
  print -u2 "找不到 Electron.app。请先运行 pnpm install --frozen-lockfile。"
  exit 1
fi

source_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SOURCE_APP/Contents/Info.plist")"

if [[ ! -d "$TARGET_APP" ]]; then
  mkdir -p "$APPLICATIONS_DIR"
  print "首次准备固定开发应用：$TARGET_APP"
  /usr/bin/ditto "$SOURCE_APP" "$TARGET_APP"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.snipvia.desktop.dev' "$TARGET_APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleName 截然 Dev' "$TARGET_APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName 截然 Dev' "$TARGET_APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :NSScreenCaptureUsageDescription string 截然需要录制你框选的屏幕区域，以生成截图并执行你选择的操作。' "$TARGET_APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :NSAppleEventsUsageDescription string 仅在你选择网页目标时匹配并切换 Chrome 已打开的标签，不会粘贴或发送内容。' "$TARGET_APP/Contents/Info.plist"
  if [[ -f "$ROOT_DIR/build/Snipvia.icns" ]]; then
    /usr/bin/ditto "$ROOT_DIR/build/Snipvia.icns" "$TARGET_APP/Contents/Resources/Snipvia.icns"
    /usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile Snipvia.icns' "$TARGET_APP/Contents/Info.plist"
  fi
  /usr/bin/xattr -cr "$TARGET_APP"
  /usr/bin/codesign --force --deep --sign - "$TARGET_APP"
fi

if ! /usr/libexec/PlistBuddy -c 'Print :NSScreenCaptureUsageDescription' "$TARGET_APP/Contents/Info.plist" >/dev/null 2>&1; then
  print "为固定开发应用补充 macOS 录屏用途声明（一次性迁移）。"
  /usr/libexec/PlistBuddy -c 'Add :NSScreenCaptureUsageDescription string 截然需要录制你框选的屏幕区域，以生成截图并执行你选择的操作。' "$TARGET_APP/Contents/Info.plist"
  /usr/bin/codesign --force --deep --sign - "$TARGET_APP"
fi

# Apple Events authorization belongs to the responsible app, not the child helper.
# Upgrade only while stopped, retaining a complete, verified local recovery copy.
if [[ "${SNIPVIA_DEV_AUTOMATION_UPGRADE:-0}" == "1" ]] && ! /usr/libexec/PlistBuddy -c 'Print :NSAppleEventsUsageDescription' "$TARGET_APP/Contents/Info.plist" >/dev/null 2>&1; then
  if /usr/bin/pgrep -f -x "$TARGET_APP/Contents/MacOS/Electron $ROOT_DIR" >/dev/null 2>&1; then
    print -u2 "请先退出截然 Dev，再启动以补充 Chrome 自动化用途声明。"
    exit 1
  fi
  permission_backup="$RUNTIME_DIR/dev-permissions/$(date +%Y%m%d-%H%M%S)-$$/截然 Dev.app"
  mkdir -p "${permission_backup:h}"
  chmod 700 "${permission_backup:h}"
  /usr/bin/ditto "$TARGET_APP" "$permission_backup"
  /usr/bin/codesign --verify --deep --strict "$permission_backup"
  print "已备份开发应用：$permission_backup"
  if ! (
    /usr/libexec/PlistBuddy -c 'Add :NSAppleEventsUsageDescription string 仅在你选择网页目标时匹配并切换 Chrome 已打开的标签，不会粘贴或发送内容。' "$TARGET_APP/Contents/Info.plist" &&
    /usr/bin/codesign --force --sign - --preserve-metadata=entitlements,requirements,flags,runtime "$TARGET_APP" &&
    /usr/bin/codesign --verify --deep --strict "$TARGET_APP"
  ); then
    /usr/bin/ditto "$permission_backup" "$TARGET_APP"
    print -u2 "开发权限声明迁移失败，已从备份恢复；未修改用户数据。"
    exit 1
  fi
  print "已补充 Chrome 用途声明；若 macOS 要求，请重新允许截然 Dev 的录屏权限。"
fi

target_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET_APP/Contents/Info.plist")"
if [[ "$target_version" != "$source_version" ]]; then
  print -u2 "固定开发应用使用 Electron $target_version，当前依赖为 $source_version。"
  print -u2 "Electron 升级会改变 macOS 权限主体；请先继续使用原版本，或明确重新创建开发应用并重新授权一次。"
  exit 1
fi

if ! /usr/bin/codesign --verify --deep --strict "$TARGET_APP" 2>/dev/null; then
  print -u2 "固定开发应用签名已损坏：$TARGET_APP"
  print -u2 "为避免丢失录屏权限，启动器不会自动覆盖它。"
  exit 1
fi

assert_development_app_stopped() {
  if /usr/bin/pgrep -f -x "$TARGET_APP/Contents/MacOS/Electron $ROOT_DIR" >/dev/null 2>&1; then
    print -u2 "系统图标更新需要修改应用包。请先退出正在运行的截然 Dev，再运行 pnpm dev。"
    exit 1
  fi
}

if [[ -f "$ROOT_DIR/build/Snipvia.icns" ]]; then
  # A new resource name avoids reusing the previous system icon cache entry.
  icon_inputs=("$ROOT_DIR/build/Snipvia.icns")
  if [[ -f "$ROOT_DIR/build/SnipviaAssets.car" ]]; then icon_inputs+=("$ROOT_DIR/build/SnipviaAssets.car"); fi
  icon_revision="$(/bin/cat "${icon_inputs[@]}" | /usr/bin/shasum -a 256 | /usr/bin/cut -c 1-12)"
  icon_name="Snipvia-$icon_revision.icns"
  current_icon="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$TARGET_APP/Contents/Info.plist" 2>/dev/null || true)"
  current_asset="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconName' "$TARGET_APP/Contents/Info.plist" 2>/dev/null || true)"
  icon_changed=false
  if [[ "$current_icon" != "$icon_name" ]] || ! /usr/bin/cmp -s "$ROOT_DIR/build/Snipvia.icns" "$TARGET_APP/Contents/Resources/$icon_name"; then
    assert_development_app_stopped
    /usr/bin/ditto "$ROOT_DIR/build/Snipvia.icns" "$TARGET_APP/Contents/Resources/$icon_name"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile $icon_name" "$TARGET_APP/Contents/Info.plist"
    icon_changed=true
  fi
  if [[ -f "$ROOT_DIR/build/SnipviaAssets.car" ]]; then
    if [[ "$current_asset" != 'Icon' ]] || ! /usr/bin/cmp -s "$ROOT_DIR/build/SnipviaAssets.car" "$TARGET_APP/Contents/Resources/Assets.car"; then
      assert_development_app_stopped
      /usr/bin/ditto "$ROOT_DIR/build/SnipviaAssets.car" "$TARGET_APP/Contents/Resources/Assets.car"
      if [[ -n "$current_asset" ]]; then
        /usr/libexec/PlistBuddy -c 'Set :CFBundleIconName Icon' "$TARGET_APP/Contents/Info.plist"
      else
        /usr/libexec/PlistBuddy -c 'Add :CFBundleIconName string Icon' "$TARGET_APP/Contents/Info.plist"
      fi
      icon_changed=true
    fi
  fi
  if [[ "$icon_changed" == true ]]; then
    print "同步固定开发应用的系统图标与分层资源。"
    /usr/bin/codesign --force --sign - --preserve-metadata=entitlements,requirements,flags,runtime "$TARGET_APP"
    /usr/bin/codesign --verify --deep --strict "$TARGET_APP"
    /usr/bin/touch "$TARGET_APP/Contents/Info.plist" "$TARGET_APP"
  fi
fi

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$TARGET_APP"

if [[ ! -x "$ROOT_DIR/build/native/snipvia-capture-helper" ]]; then
  cd "$ROOT_DIR"
  pnpm native:build
fi

mkdir -p "$RUNTIME_DIR"
rm -f "$RUNTIME_APP"
ln -s "$TARGET_APP" "$RUNTIME_APP"

export ELECTRON_OVERRIDE_DIST_PATH="$RUNTIME_DIR"
export SNIPVIA_DEV_APP_PATH="$TARGET_APP"
export SNIPVIA_PROJECT_ROOT="$ROOT_DIR"
export ELECTRON_EXEC_PATH="$ROOT_DIR/scripts/electron-launchservices-wrapper.sh"

print "使用固定开发应用：$TARGET_APP"
print "通过 macOS Launch Services 启动，权限将绑定到固定开发应用。"
print "普通源码修改沿用固定应用；图标或运行时更新后，请按系统提示检查录屏权限。"
if [[ "$PREPARE_ONLY" == true ]]; then exit 0; fi
cd "$ROOT_DIR"
exec pnpm exec electron-vite dev --watch
