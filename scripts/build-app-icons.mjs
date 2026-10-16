import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

// Keep authored UI assets intact; export system assets and static Mac fallbacks.
if (process.platform !== 'darwin') throw new Error('Mac 图标导出需要 macOS 和 Xcode 26+；Windows 直接使用 UI 中的 PNG / ICO。');
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.DEVELOPER_DIR ??= '/Applications/Xcode.app/Contents/Developer';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
// Use the same compiler as the pinned electron-builder packaging implementation.
const { generateAssetCatalogForIcon } = builderRequire('app-builder-lib/out/util/macosIconComposer.js');
const { icnsFile, assetCatalog } = await generateAssetCatalogForIcon(join(root, 'UI/Snipvia-2-mac.icon'));
const directory = await mkdtemp(join(tmpdir(), 'snipvia-app-icons-'));
try {
  const icns = join(directory, 'Snipvia.icns');
  const iconset = join(directory, 'Snipvia.iconset');
  await writeFile(icns, icnsFile);
  execFileSync('/usr/bin/iconutil', ['-c', 'iconset', icns, '-o', iconset]);
  await copyFile(join(iconset, 'icon_128x128@2x.png'), join(root, 'src/renderer/src/assets/snipvia-app-icon.png'));
  await copyFile(icns, join(root, 'build/Snipvia.icns'));
  await writeFile(join(root, 'build/SnipviaAssets.car'), assetCatalog);
  console.log('已从 Mac 源图标导出标题栏 PNG、ICNS 和系统分层图标资源。');
} finally {
  await rm(directory, { recursive: true, force: true });
}
