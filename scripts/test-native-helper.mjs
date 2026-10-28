import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';

const helperPath = resolve('build/native/snipvia-capture-helper');
const child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffered = Buffer.alloc(0);
let stderr = '';
const pending = new Map();

function request(command, values = {}, timeoutMs = 2000) {
  const requestId = randomUUID();
  const promise = new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${command} timed out${stderr ? `: ${stderr.trim()}` : ''}`));
    }, timeoutMs);
    pending.set(requestId, { resolve: resolveRequest, reject, timer });
    child.stdin.write(`${JSON.stringify({ version: 1, requestId, command, ...values })}\n`);
  });
  return { requestId, promise };
}

function parse() {
  while (buffered.byteLength >= 4) {
    const headerLength = buffered.readUInt32BE(0);
    if (buffered.byteLength < 4 + headerLength) return;
    const header = JSON.parse(buffered.subarray(4, 4 + headerLength).toString('utf8'));
    const payloadLength = Number(header.payloadLength ?? 0);
    if (buffered.byteLength < 4 + headerLength + payloadLength) return;
    buffered = buffered.subarray(4 + headerLength + payloadLength);
    if (header.kind === 'event' || !header.requestId) continue;
    const item = pending.get(header.requestId);
    if (!item) continue;
    clearTimeout(item.timer);
    pending.delete(header.requestId);
    if (header.kind !== 'response' || !header.ok) item.reject(new Error(header.error ?? 'helper request failed'));
    else item.resolve(header);
  }
}

child.stdout.on('data', (chunk) => {
  buffered = Buffer.concat([buffered, chunk]);
  parse();
});
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4096); });
child.once('exit', (code, signal) => {
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error(`helper exited (${code ?? signal ?? 'unknown'})`));
  }
  pending.clear();
});

try {
  const ping = await request('ping').promise;
  if (!Number.isInteger(ping.helperPid) || ping.helperPid <= 0) throw new Error('ping did not return helperPid');
  const isolatedSessionId = `capture_${Date.now()}_protocol`;
  const isolated = await request('ping', { captureSessionId: isolatedSessionId }).promise;
  if (isolated.captureSessionId !== isolatedSessionId) throw new Error('captureSessionId was not preserved by the helper protocol');

  let ocrRejected = false;
  try { await request('ocr').promise; } catch (error) { ocrRejected = error.message.includes('Unknown command: ocr'); }
  if (!ocrRejected) throw new Error('retired OCR command was not rejected');

  let unknownRejected = false;
  try { await request('not-a-command').promise; } catch { unknownRejected = true; }
  if (!unknownRejected) throw new Error('unknown command was not rejected');

  const sleeping = request('sleep', { displayId: 1, delayMs: 5000 }, 2000);
  const sleepingRejected = sleeping.promise.then(() => false, () => true);
  const started = performance.now();
  const cancelled = request('cancel', { targetRequestId: sleeping.requestId });
  await cancelled.promise;
  const sleepRejected = await sleepingRejected;
  if (!sleepRejected) throw new Error('cancelled request did not reject');
  if (performance.now() - started > 1000) throw new Error('cancellation did not stop the request promptly');

  await request('dispose').promise;
  console.info('ScreenCaptureKit helper protocol tests passed');
} finally {
  if (!child.killed && child.exitCode === null) child.kill();
}
