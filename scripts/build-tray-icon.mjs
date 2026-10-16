import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

if (process.platform !== 'darwin') throw new Error('菜单栏 PNG 导出使用 macOS sips；其他平台可使用已生成的资源。');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const { runIconsTool } = builderRequire('app-builder-lib/out/toolsets/icons.js');
const directory = await mkdtemp(join(tmpdir(), 'snipvia-tray-icon-'));
try {
  // The pinned builder renderer preserves SVG transparency and even-odd cutouts.
  await runIconsTool({ inputFile: join(root, 'build/TrayTemplate.svg'), outputFormat: 'set', outDir: directory });
  for (const [size, name] of [[18, 'TrayTemplate.png'], [36, 'TrayTemplate@2x.png']]) {
    execFileSync('/usr/bin/sips', ['-z', String(size), String(size), join(directory, '512x512.png'), '--out', join(root, 'build', name)], { stdio: 'ignore' });
  }
  console.log('已导出黑白菜单栏模板图标：18px 和 Retina 36px。');
} finally {
  await rm(directory, { recursive: true, force: true });
}
