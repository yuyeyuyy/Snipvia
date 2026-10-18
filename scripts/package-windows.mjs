import console from 'node:console';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { prepareReleaseBuild } from './prepare-release-build.mjs';
import { verifyWindowsBuild } from './verify-windows-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
prepareReleaseBuild();
const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require('electron-builder');
const base = join(root, 'dist', 'windows-internal');
await mkdir(base, { recursive: true });
// Each run gets a fresh directory, including failed builds. Never reuse dist's
// existing Mac releases or the older Windows EXEs as evidence for this build.
const output = await mkdtemp(join(base, 'internal-'));
console.log(`Windows 内部测试输出：${output}`);
await build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  config: { extends: join(root, 'electron-builder.windows.yml'), directories: { output } },
  publish: 'never'
});
await verifyWindowsBuild(output);
