import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import supplements from './license-supplements.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'out/licenses');
const tree = JSON.parse(execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32' }));
const notices = [];
const packages = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function licenseFiles(directory, prefix = '', depth = 0) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const name = join(prefix, entry.name);
    if (entry.isDirectory() && depth < 4) files.push(...await licenseFiles(join(directory, entry.name), name, depth + 1));
    else if (entry.isFile() && /^(?:licen[cs]e|copying|notice|copyright|authors)(?:[._-].*)?$/i.test(entry.name)) files.push(name);
  }
  return files.sort();
}
for (const entries of Object.values(tree)) for (const entry of entries) for (const path of entry.paths) {
  const directory = await realpath(path);
  const local = relative(join(root, 'node_modules'), directory);
  if (isAbsolute(local) || local.startsWith(`..${sep}`) || local === '..' || resolve(directory) === join(root, 'node_modules')) throw new Error('Dependency notice path must be inside this workspace node_modules');
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const id = `${metadata.name}@${metadata.version}`;
  if (packages.has(id)) continue;
  const files = [];
  for (const name of await licenseFiles(directory)) {
    const bytes = await readFile(join(directory, name));
    const label = name.split(sep).join('/');
    files.push({ file: label, sha256: digest(bytes) });
    notices.push(`\n${'='.repeat(72)}\n${id} — ${label}\nDeclared license: ${entry.license}\n${'='.repeat(72)}\n${bytes.toString('utf8')}\n`);
  }
  if (!files.length) {
    const supplement = supplements.reviewedSupplement(directory, metadata);
    if (supplement) {
      const { bytes, ...record } = supplement;
      files.push(record);
      notices.push(`\n${'='.repeat(72)}\n${id} — ${record.file}\nReviewed supplement, NOT an original upstream notice.\n${'='.repeat(72)}\n${bytes.toString('utf8')}\nProvenance: ${JSON.stringify(record.provenance)}\n`);
    }
  }
  packages.set(id, { name: metadata.name, version: metadata.version, license: entry.license,
    ...(metadata.name === 'node-forge' ? { selectedLicense: 'BSD-3-Clause' } : {}),
    homepage: typeof metadata.homepage === 'string' ? metadata.homepage : null, notices: files });
}
await mkdir(output, { recursive: true });
const inventory = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
const missing = inventory.filter(item => !item.notices.length).map(item => `${item.name}@${item.version}`);
const electron = JSON.parse(await readFile(join(root, 'node_modules/electron/package.json'), 'utf8'));
const electronNotices = [];
for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
  const bytes = await readFile(join(root, 'node_modules/electron/dist', name));
  await writeFile(join(output, name === 'LICENSE' ? 'ELECTRON_LICENSE' : name), bytes);
  electronNotices.push({ file: name === 'LICENSE' ? 'ELECTRON_LICENSE' : name, sha256: digest(bytes) });
}
await writeFile(join(output, 'THIRD_PARTY_LICENSES.txt'), `Snipvia production dependency notices. Original license/copyright text and explicitly labeled reviewed supplements follow.\nnode-forge is used under its BSD-3-Clause option.\nUnreviewed missing license files require manual review; package metadata alone is not clearance.\n${notices.join('')}`);
await writeFile(join(output, 'dependencies.json'), JSON.stringify({ scope: 'installed production dependency graph; may exceed packaged dependencies', packages: inventory,
  electron: { version: electron.version, notices: electronNotices }, missingLicenseFiles: missing }, null, 2) + '\n');
console.log(`Dependency notices: ${inventory.length} production package versions; ${missing.length} without a detected license file; Electron ${electron.version}.`);
if (missing.length) console.log(`Manual license-file review required: ${missing.join(', ')}`);
