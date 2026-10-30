import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url), builder = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar') as { createPackage(source: string, archive: string): Promise<void> };
const moduleUrl = pathToFileURL(resolve('scripts/verify-windows-build.mjs')).href;
const { inspectWindowsArchive, chooseNsisInspector } = await import(moduleUrl) as { inspectWindowsArchive(archive: string, version: string): void; chooseNsisInspector(candidates: string[], inspect: (file: string) => string): string };
const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function archive({ missing = '', extra = '', version = '1.0.0' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-asar-')); temporary.push(directory);
  const source = join(directory, 'source'), output = join(directory, 'app.asar');
  const files = ['out/main/index.js', 'out/main/capture-png-worker.js', 'out/preload/index.js', 'out/renderer/index.html'];
  if (extra) files.push(extra);
  for (const file of files.filter(file => file !== missing)) {
    const path = join(source, ...file.split('/'));
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'synthetic fixture');
  }
  await writeFile(join(source, 'package.json'), JSON.stringify({ version }));
  await asar.createPackage(source, output);
  return output;
}

it('verifies the real ASAR entry tree with host-native API paths', async () => {
  const file = await archive();
  expect(() => inspectWindowsArchive(file, '1.0.0')).not.toThrow();
});
it('rejects missing workers and packages with a different version', async () => {
  const missing = await archive({ missing: 'out/main/capture-png-worker.js' });
  expect(() => inspectWindowsArchive(missing, '1.0.0')).toThrow();
  const old = await archive({ version: '0.3.2' });
  expect(() => inspectWindowsArchive(old, '1.0.0')).toThrow();
});
it('rejects native modules and macOS resources on every host OS', async () => {
  for (const extra of ['out/vendor/helper.js', 'out/native/addon.node', 'out/App.icon/Assets/image.png']) {
    const file = await archive({ extra });
    expect(() => inspectWindowsArchive(file, '1.0.0')).toThrow('Unexpected native or macOS resources');
  }
});


it('requires a real NSIS handler instead of accepting a PE-only inspector', () => {
  const capabilities: Record<string, string> = {
    standalone: 'Nsis is unavailable\nFormats:\n 0 C... 7z 7z\nCodecs:\n',
    full: 'Formats:\n 0 C... 7z 7z\n 1 .... Nsis nsis\nCodecs:\n'
  };
  expect(chooseNsisInspector(['missing', 'standalone', 'full'], file => {
    if (!(file in capabilities)) throw new Error('not installed');
    return capabilities[file];
  })).toBe('full');
});
it('fails closed when no inspector can decode NSIS', () => {
  expect(() => chooseNsisInspector(['standalone'], () => 'Formats:\n PE exe\nCodecs:\n')).toThrow('NSIS support');
});
