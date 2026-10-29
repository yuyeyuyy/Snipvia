import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import { performance } from 'node:perf_hooks';

const execute = promisify(execFile);
if (process.platform !== 'darwin') throw new Error('macOS native helper acceptance requires macOS.');
const directory = await mkdtemp(join(tmpdir(), 'snipvia-target-native-'));
const helper = resolve('build/native/snipvia-quick-target-helper');
let peer;
try {
  assert.equal(JSON.parse((await execute(helper, ['browser-script-check'])).stdout).compiled, true);
  const bundle = join(directory, 'Target Peer.app'), binary = join(bundle, 'Contents/MacOS/peer'), identifier = 'com.snipvia.test.target-peer';
  await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
  await writeFile(join(bundle, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>' + identifier + '</string><key>CFBundleName</key><string>Target Peer</string><key>CFBundleExecutable</key><string>peer</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  const source = join(directory, 'peer.swift');
  await writeFile(source, 'import AppKit\nlet app=NSApplication.shared\napp.setActivationPolicy(.regular)\nlet window=NSWindow(contentRect:NSRect(x:150,y:150,width:420,height:180),styleMask:[.titled,.closable],backing:.buffered,defer:false)\nwindow.title="Snipvia synthetic target"\nwindow.contentView=NSTextField(string:"Synthetic fixture; no messages or user data")\nwindow.makeKeyAndOrderFront(nil)\napp.run()\n');
  await execute('/usr/bin/xcrun', ['swiftc', '-module-cache-path', join(directory, 'module-cache'), '-framework', 'AppKit', source, '-o', binary]);
  const info = JSON.parse((await execute(helper, ['describe', bundle])).stdout);
  assert.equal(info.bundleId, identifier); assert.equal(info.path, bundle);
  await assert.rejects(execute(helper, ['describe', '/bin/sh']));
  await assert.rejects(execute(helper, ['activate', bundle, 'wrong.bundle', 'true']));
  await assert.rejects(execute(helper, ['activate', bundle, identifier, 'false']));
  peer = spawn(binary, [], { stdio: 'ignore' });
  peer.on('error', () => {});
  const deadline = Date.now() + 5000;
  let running = false;
  while (Date.now() < deadline) {
    running = JSON.parse((await execute(helper, ['status', bundle])).stdout).running;
    if (running) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert(running, 'The synthetic native peer must register before activation');
  const start = performance.now();
  const result = JSON.parse((await execute(helper, ['activate', bundle, identifier, 'false'])).stdout);
  assert.equal(result.activated, true);
  console.log(JSON.stringify({ syntheticPeerActivation: 'passed', verifiedForegroundInHelper: true, activationMs: Math.round(performance.now() - start), invalidBundleRejected: true, launchingDisabledHonored: true, noUserData: true }));
} finally {
  if (peer && peer.exitCode === null && peer.signalCode === null) { const exited = new Promise(resolve => peer.once('exit', resolve)); peer.kill('SIGTERM'); await exited; }
  await rm(directory, { recursive: true, force: true });
}
