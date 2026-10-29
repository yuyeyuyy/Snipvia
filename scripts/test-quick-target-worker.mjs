import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';

if (process.platform !== 'darwin') throw new Error('Native browser pipe acceptance requires macOS and installed Chrome terminology.');
const child = spawn(resolve('build/native/snipvia-quick-target-helper'), ['browser-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
const lines = createInterface({ input: child.stdout });
function response() {
  return new Promise((accept, reject) => {
    const cleanup = () => { clearTimeout(timer); lines.removeListener('line', line); child.removeListener('exit', fail); child.removeListener('error', fail); };
    const fail = () => { cleanup(); reject(new Error('Native browser worker exited before a response.')); };
    const timer = setTimeout(fail, 5000);
    const line = value => { cleanup(); try { accept(JSON.parse(value)); } catch { reject(new Error('Invalid native response.')); } };
    lines.once('line', line); child.once('exit', fail); child.once('error', fail);
  });
}
try {
  const start = performance.now(); assert.deepEqual(await response(), { ready: true });
  const warmupMs = Math.round(performance.now() - start), roundTrips = [];
  for (let index = 0; index < 3; index++) {
    const id = randomUUID(), result = response(), started = performance.now();
    child.stdin.write(JSON.stringify({ id, command: 'browser-select', input: {} }) + '\n');
    assert.deepEqual(await result, { id, ok: false, error: 'invalid' });
    roundTrips.push(Math.round(performance.now() - started));
  }
  console.log(JSON.stringify({ nativeWorker: 'passed', warmupMs, invalidRequestRoundTripMs: roundTrips, noBrowserQueryOrActivation: true }));
} finally {
  lines.close();
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(accept => child.once('exit', accept)); child.kill(); await exited;
  }
}
