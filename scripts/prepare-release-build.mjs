import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const nativeFiles = ['snipvia-capture-helper', 'snipvia-capture-helper-arm64', 'snipvia-capture-helper-x86_64', 'snipvia-quick-target-helper', 'snipvia-quick-target-helper-arm64', 'snipvia-quick-target-helper-x86_64'];

export function fingerprint(root, files, context = {}) {
  const hash = createHash('sha256').update(JSON.stringify(context));
  for (const name of [...files].sort()) {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error('Release inputs must be regular files.');
    hash.update(JSON.stringify([name, stat.mode & 0o777, stat.size]));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function tree(root, directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return tree(root, name);
    if (!entry.isFile()) throw new Error('Unexpected release output type.');
    return [name];
  });
}

export function canReuse(receipt, input, output) {
  return receipt?.schema === 1 && receipt.passed === true
    && receipt.input === input && receipt.output === output;
}

/** Execute pnpm through Node on Windows; .cmd files require a shell and cannot be execFile targets. */
export function buildCommand(command, args, { platform = process.platform, node = process.execPath, pnpm = process.env.npm_execpath } = {}) {
  if (command !== 'pnpm' || platform !== 'win32') return { command, args };
  if (!pnpm || !path.win32.isAbsolute(pnpm) || !/^pnpm\.(?:c|m)?js$/i.test(path.win32.basename(pnpm))) {
    throw new Error('Windows release preparation must be started through pnpm.');
  }
  return { command: node, args: [pnpm, ...args] };
}

function run(root, command, args, inherit = false) {
  const invocation = buildCommand(command, args);
  try {
    return execFileSync(invocation.command, invocation.args, {
      cwd: root, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024
    })?.trim();
  } catch (error) {
    throw new Error(`Release preparation failed: ${path.basename(command)} (${error.status ?? 'start failed'}).`);
  }
}

function sourceFiles(root) {
  return run(root, 'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(name => name && fs.existsSync(path.join(root, name))
      && (!name.includes('/') || /^(src|tests|native|scripts|build|UI)\//.test(name)))
    .filter(name => !['README.md', 'AGENTS.md', '.env.example'].includes(name));
}

function cachedStep(root, name, inputs, outputs, context, command, args) {
  const directory = path.join(root, '.dev-runtime/release-build');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${name}.json`);
  const input = fingerprint(root, inputs(), context);
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Missing/corrupt receipts trigger a new build. */ }
  let output;
  try { output = fingerprint(root, outputs()); } catch { /* Missing outputs trigger a new build. */ }
  if (canReuse(receipt, input, output)) {
    console.log(`Reuse verified ${name}: ${input.slice(0, 12)}`);
    return receipt;
  }
  // Invalidate old evidence before running. Failed commands never leave a passed receipt.
  fs.rmSync(file, { force: true });
  run(root, command, args, true);
  if (fingerprint(root, inputs(), context) !== input) throw new Error('Release inputs changed during build.');
  const result = { schema: 1, passed: true, input, output: fingerprint(root, outputs()),
    completedAt: new Date().toISOString(), node: process.version };
  const pending = `${file}.${process.pid}.pending`;
  fs.writeFileSync(pending, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(pending, file);
  console.log(`Recorded verified ${name}: ${input.slice(0, 12)}`);
  return result;
}

export function prepareReleaseBuild({ root = defaultRoot, native = false } = {}) {
  const pnpm = run(root, 'pnpm', ['--version']);
  if (!/^v24\.15\./.test(process.version) || pnpm !== '11.1.3') throw new Error('Use Node 24.15.x and pnpm 11.1.3.');
  const context = { node: process.version, pnpm, platform: process.platform, arch: process.arch,
    // Values are hashed, never logged or written into the receipt.
    environment: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(VITE_|ELECTRON_VITE_|NODE_ENV$|SOURCE_DATE_EPOCH$)/.test(key)).sort(([a], [b]) => a.localeCompare(b))) };
  const build = cachedStep(root, 'desktop', () => [...sourceFiles(root),
    'node_modules/.pnpm/lock.yaml', 'node_modules/.modules.yaml'], () => {
    for (const name of ['main/index.js', 'main/capture-png-worker.js', 'preload/index.js', 'renderer/index.html', 'licenses/dependencies.json']) {
      if (!fs.statSync(path.join(root, 'out', name)).isFile()) throw new Error('Incomplete desktop build.');
    }
    return tree(root, 'out');
  }, context, 'pnpm', ['build']);
  if (!native) return { build };
  if (process.platform !== 'darwin') throw new Error('Native macOS release preparation requires macOS.');
  const developerDir = process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer';
  const nativeContext = { ...context, developerDir,
    xcode: run(root, '/usr/bin/xcodebuild', ['-version']),
    swift: run(root, '/usr/bin/xcrun', ['swiftc', '--version']) };
  const helper = cachedStep(root, 'native', () => ['native/screen-capture-kit-helper/main.swift', 'native/screen-capture-kit-helper/FrozenFrameCache.swift',
    'scripts/build-native-helper.sh', 'native/quick-target-helper/main.swift', 'native/quick-target-helper/Browser.swift', 'native/quick-target-helper/Info.plist', 'scripts/build-quick-target-helper.sh', 'scripts/prepare-release-build.mjs'],
  () => nativeFiles.map(name => `build/native/${name}`), nativeContext, 'pnpm', ['native:build']);
  return { build, native: helper };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--native')) throw new Error('Usage: pnpm release:prepare [--native]');
  prepareReleaseBuild({ native: process.argv.includes('--native') });
}
