import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = libRequire('@electron/asar');
const { NtExecutable, NtExecutableResource, Resource } = libRequire('resedit');
const { getPath7za } = builderRequire('app-builder-lib/out/toolsets/7zip.js');
const hash = buffer => createHash('sha256').update(buffer).digest('hex');

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function inspectPe(buffer) {
  assert.equal(buffer.toString('ascii', 0, 2), 'MZ', 'Missing Windows executable header');
  const offset = buffer.readUInt32LE(0x3c);
  assert.equal(buffer.toString('ascii', offset, offset + 4), 'PE\0\0');
  const optional = offset + 24;
  const directories = optional + (buffer.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const entries = NtExecutableResource.from(NtExecutable.from(buffer)).entries;
  const versions = Resource.VersionInfo.fromEntries(entries);
  const strings = versions.flatMap(version => version.getAllLanguagesForStringValues().map(lang => version.getStringValues(lang)));
  const manifest = entries.filter(entry => entry.type === 24).map(entry => Buffer.from(entry.bin).toString('utf8')).join('\n');
  return { machine: buffer.readUInt16LE(offset + 4), certificateBytes: buffer.readUInt32LE(directories + 4 * 8 + 4),
    strings, iconCount: entries.filter(entry => entry.type === 3).length, manifest };
}

export async function verifyWindowsBuild(outputDirectory) {
  const output = resolve(outputDirectory);
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const installer = join(output, `Snipvia-Setup-${version}-x64.exe`);
  const appDirectory = join(output, 'win-unpacked');
  const appAsar = join(appDirectory, 'resources', 'app.asar');
  const executable = await readFile(join(appDirectory, 'Snipvia.exe'));
  const pe = inspectPe(executable);
  const sourceIcon = await readFile(join(root, 'UI', 'Snipvia-Win-transparent.ico'));
  const iconFrames = [];
  assert.equal(sourceIcon.readUInt16LE(0), 0); assert.equal(sourceIcon.readUInt16LE(2), 1);
  for (let index = 0; index < sourceIcon.readUInt16LE(4); index++) {
    const entry = 6 + index * 16, size = sourceIcon.readUInt32LE(entry + 8), offset = sourceIcon.readUInt32LE(entry + 12);
    assert(offset + size <= sourceIcon.length, 'Truncated source ICO');
    iconFrames.push(hash(sourceIcon.subarray(offset, offset + size)));
  }
  const embeddedIconHashes = buffer => NtExecutableResource.from(NtExecutable.from(buffer)).entries
    .filter(entry => entry.type === 3).map(entry => hash(Buffer.from(entry.bin))).sort();
  assert.deepEqual(embeddedIconHashes(executable), [...iconFrames].sort(), 'Application PE icon differs from selected ICO');
  assert.equal(pe.machine, 0x8664, 'Application must be Windows x64');
  assert.equal(pe.certificateBytes, 0, 'Internal application must be unsigned');
  assert(pe.strings.some(value => value.ProductName === 'Snipvia' && value.FileVersion === version));
  assert(pe.iconCount >= 7, 'Multi-size brand icon missing');
  assert.match(pe.manifest, /requestedExecutionLevel[^>]+level="asInvoker"/);
  const icon = await readFile(join(appDirectory, 'resources', 'Snipvia.ico'));
  assert.equal(hash(icon), hash(sourceIcon));
  const paths = asar.listPackage(appAsar);
  const forbidden = paths.filter(path => /snipvia-capture-helper|\.(?:node|dylib|so|swift|icns)$|\.icon\/|\/vendor\//i.test(path));
  assert.deepEqual(forbidden, [], 'Unexpected native or macOS resources in ASAR');
  for (const file of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) assert(asar.statFile(appAsar, file).size > 0);
  assert.equal(JSON.parse(asar.extractFile(appAsar, 'package.json').toString()).version, version);
  const resources = await walk(join(appDirectory, 'resources'));
  assert(!resources.some(path => /snipvia-capture-helper|elevate\.exe|\.(?:node|dylib|so|swift|icns)$/i.test(path)));
  const installerBytes = await readFile(installer);
  const installerPe = inspectPe(installerBytes);
  assert.deepEqual(embeddedIconHashes(installerBytes), [...iconFrames].sort(), 'Installer PE icon differs from selected ICO');
  assert.equal(installerPe.certificateBytes, 0, 'Internal installer must be unsigned');
  assert(installerPe.strings.some(value => value.ProductName === 'Snipvia' && value.ProductVersion === version));
  assert.match(installerPe.manifest, /requestedExecutionLevel[^>]+level="asInvoker"/);
  const sevenZip = await getPath7za();
  const scratch = await mkdtemp(join(tmpdir(), 'snipvia-win-contents-'));
  try {
    execFileSync(sevenZip, ['t', installer], { stdio: 'pipe' });
    execFileSync(sevenZip, ['x', installer, `-o${scratch}`, '-y'], { stdio: 'pipe' });
    const extracted = await walk(scratch);
    const payload = extracted.find(path => path.endsWith('app-64.7z'));
    assert(payload, 'NSIS x64 application payload missing');
    assert(extracted.some(path => /uninst.*\.exe$/i.test(path)), 'NSIS uninstaller missing');
    const unpacked = join(scratch, 'payload');
    execFileSync(sevenZip, ['x', payload, `-o${unpacked}`, '-y', 'Snipvia.exe', 'resources/app.asar', 'resources/Snipvia.ico'], { stdio: 'pipe' });
    assert.equal(hash(await readFile(join(unpacked, 'Snipvia.exe'))), hash(executable));
    assert.equal(hash(await readFile(join(unpacked, 'resources', 'app.asar'))), hash(await readFile(appAsar)));
    assert.equal(hash(await readFile(join(unpacked, 'resources', 'Snipvia.ico'))), hash(icon));
  } finally { await rm(scratch, { recursive: true, force: true }); }
  const metadata = { version, architecture: 'x64', installer, filename: `Snipvia-Setup-${version}-x64.exe`,
    bytes: (await stat(installer)).size, sha256: hash(installerBytes), signed: false,
    verification: 'Static PE, ASAR, NSIS payload and uninstaller checks passed; Windows runtime not verified',
    iconSource: 'UI/Snipvia-Win-transparent.ico', iconSha256: hash(sourceIcon),
    embeddedApplicationIconsMatch: true, embeddedInstallerIconsMatch: true,
    nativeNodeModules: 0, appIconSizes: pe.iconCount };
  await writeFile(join(output, 'BUILD_METADATA.json'), JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(join(output, 'SHA256SUMS.txt'), `${metadata.sha256}  ${metadata.filename}\n`);
  console.log(JSON.stringify(metadata, null, 2));
  return metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], 'Usage: pnpm windows:verify <build-output-directory>');
  await verifyWindowsBuild(process.argv[2]);
}
