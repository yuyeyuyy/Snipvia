import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

if (process.platform !== 'darwin' || process.env.SNIPVIA_REAL_CLIPBOARD !== '1') {
  throw new Error('macOS opt-in required: SNIPVIA_REAL_CLIPBOARD=1 node scripts/test-collection-clipboard-native.mjs');
}
const root = resolve('.'), directory = await mkdtemp(join(tmpdir(), 'snipvia-clipboard-native 中文-'));
const require = createRequire(join(root, 'package.json')), electron = require('electron');
const bootstrap = join(directory, 'probe.cjs'), executable = join(directory, 'probe');
const bootstrapSource = String.raw`const { app, clipboard, ClipboardItem, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), readline = require('node:readline');
const root = ROOT_PLACEHOLDER, directory = process.argv[2], token = process.argv[3];
app.setPath('userData', path.join(directory, 'user-data'));
app.setActivationPolicy('prohibited');
const ts = require(path.join(root, 'node_modules/typescript'));
require('node:module')._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, file);
const { ScreenshotStore } = require(path.join(root, 'src/main/storage/ScreenshotStore.ts'));
const { ScreenshotCollection } = require(path.join(root, 'src/main/storage/ScreenshotCollection.ts'));
const { copyCollectionImages } = require(path.join(root, 'src/main/storage/CollectionClipboard.ts'));
const write = clipboard.write.bind(clipboard);
clipboard.write = async items => {
  const values = {};
  for (const type of items[0].types) values[type] = await items[0].getType(type);
  values['electron application/osclipboard;format="org.snipvia.clipboard-test"'] = new Blob([token]);
  return write([new ClipboardItem(values)]);
};
app.whenReady().then(() => {
  const store = new ScreenshotStore(path.join(directory, 'sources')), collection = new ScreenshotCollection(store);
  const ids = [], hashes = [];
  for (let i = 0; i < 3; i++) {
    const bytes = nativeImage.createFromBitmap(Buffer.alloc(32 * 24 * 4, 60 + i * 50), { width: 32, height: 24 }).toPNG();
    const item = store.create(bytes, { width: 32, height: 24, mimeType: 'image/png' });
    collection.append(item.id); ids.push(item.id); hashes.push(crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  readline.createInterface({ input: process.stdin }).on('line', async command => {
    if (command === 'finish') { app.exit(0); return; }
    if (command !== 'copy') return;
    try {
      await copyCollectionImages(store, ids, path.join(directory, 'clipboard-files'));
      const list = (await clipboard.read()).find(item => item.types.includes('text/uri-list'));
      const paths = (await (await list.getType('text/uri-list')).text()).split(/\r?\n/).map(uri => require('node:url').fileURLToPath(uri));
      collection.clear(true, collection.snapshot().revision); store.dispose();
      process.stdout.write(JSON.stringify({ paths, hashes }) + '\n');
    } catch { process.stdout.write('{"failed":true}\n'); app.exit(1); }
  });
  process.stdout.write('{"ready":true}\n');
});
`;
let safeToRemove = false;
try {
  await writeFile(bootstrap, bootstrapSource.replace('ROOT_PLACEHOLDER', JSON.stringify(root)));
  const compile = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', join(directory, 'module-cache'),
    'tests/fixtures/native-clipboard-probe.swift', '-o', executable], { encoding: 'utf8', timeout: 60_000 });
  if (compile.status !== 0) throw new Error('Native probe compile failed: ' + compile.stderr);
  const result = spawnSync(executable, [electron, bootstrap, randomUUID(), directory], { encoding: 'utf8', timeout: 35_000 });
  // Native helper emits synthetic results only, never saved clipboard contents.
  const records = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  safeToRemove = records.some(record => record.clipboardRestored === true);
  if (result.status !== 0 || !safeToRemove || !records.some(record => record.nativeFiles === 3)) {
    throw new Error('Native clipboard verification failed; synthetic cache: ' + directory + '\n' + result.stdout + result.stderr);
  }
  process.stdout.write(JSON.stringify({ nativeFiles: 3, originalBytesMatch: true, usableAfterSourceExit: true, clipboardRestored: true }) + '\n');
} finally {
  if (safeToRemove) await rm(directory, { recursive: true, force: true });
}
