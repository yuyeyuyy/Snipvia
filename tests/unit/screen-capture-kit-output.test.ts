import { afterEach, expect, it, vi } from 'vitest';
const protocol = vi.hoisted(() => ({ writes: [] as Record<string, unknown>[], badCrop: false, full: false, delayed: false, deliver: null as null | (() => void) }));
vi.mock('electron', () => ({ nativeImage: { createFromBitmap: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ access: async () => {} }));
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return { spawn: () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), killed: false, stdin: { writable: true, write: (_data: string, _cb?: (error?: Error) => void) => { void _data; void _cb; return true; } }, kill: () => true });
    child.stdin.write = (data, callback) => {
      const request = JSON.parse(data); protocol.writes.push(request);
      const send = (values: object = {}, payload = Buffer.alloc(0)) => {
        const header = Buffer.from(JSON.stringify({ kind: 'response', ok: true, requestId: request.requestId, command: request.command, captureSessionId: request.captureSessionId, payloadLength: payload.length, ...values }));
        const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
        queueMicrotask(() => child.stdout.emit('data', Buffer.concat([prefix, header, payload])));
      };
      if (request.command === 'initialize') send({ capabilities: ['frozen-frame-png'], excludedApplicationFound: true, displays: [{ id: '1', width: 400, height: 300, pixelWidth: 400, pixelHeight: 300, scaleFactor: 1 }] });
      else if (request.command === 'capture') {
        if (protocol.full) { send({ ok: false, error: 'Frozen-frame cache is full' }); callback?.(); return true; }
        const deliver = () => send({ frameToken: '123e4567-e89b-42d3-a456-426614174000', width: 400, height: 300, format: 'jpeg', capturedAtEpochMs: Date.now() }, Buffer.from([255, 216, 255, 217]));
        if (protocol.delayed) protocol.deliver = deliver; else deliver();
      } else if (request.command === 'crop') {
        const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(Number(request.cropWidth), 16); png.writeUInt32BE(Number(request.cropHeight), 20);
        send({ width: protocol.badCrop ? 999 : request.cropWidth, height: request.cropHeight }, png);
      } else send();
      callback?.(); return true;
    };
    child.kill = () => { child.killed = true; return true; };
    return child;
  } };
});
import { ScreenCaptureKitBackend } from '../../src/main/capture/screen-capture-kit-backend';
const backends: ScreenCaptureKitBackend[] = [];
function setup() {
  const backend = new ScreenCaptureKitBackend({ helperPath: '/test/helper', systemVersion: '14.0', outputFormat: () => 'jpeg', enabled: () => true, mark: () => {}, updateMetadata: () => {} });
  backends.push(backend); return backend;
}
const request = { display: { id: '1', bounds: { x: 0, y: 0, width: 400, height: 300 }, size: { width: 400, height: 300 }, scaleFactor: 1 }, performanceSessionId: 'session-one', mainWindowWasVisible: false, retainOriginal: true };
afterEach(async () => { await Promise.all(backends.splice(0).map(b => b.dispose())); protocol.writes.length = 0; protocol.badCrop = false; protocol.full = false; protocol.delayed = false; protocol.deliver = null; });
it('keeps a session-bound original for PNG output and releases it exactly once', async () => {
  const frame = await setup().captureDisplay(request), rect = { x: 10, y: 20, width: 30, height: 40 };
  const png = await frame.original!.png(rect, new AbortController().signal);
  expect(png.readUInt32BE(16)).toBe(30);
  const crop = protocol.writes.find(r => r.command === 'crop')!;
  expect(crop).toMatchObject({ captureSessionId: 'session-one', cropX: 10, cropY: 20, cropWidth: 30, cropHeight: 40 });
  frame.original!.release(); frame.original!.release();
  expect(protocol.writes.filter(r => r.command === 'release')).toHaveLength(1);
  await expect(frame.original!.png(rect, new AbortController().signal)).rejects.toThrow('失效');
});
it('rejects a mismatched crop response without losing the retained frame needed to retry', async () => {
  const frame = await setup().captureDisplay(request), rect = { x: 0, y: 0, width: 10, height: 10 };
  protocol.badCrop = true; await expect(frame.original!.png(rect, new AbortController().signal)).rejects.toThrow('无效');
  protocol.badCrop = false; expect((await frame.original!.png(rect, new AbortController().signal)).length).toBe(24);
  frame.original!.release();
});
it('releases a late native capture response after cancellation instead of leaking its cached pixels', async () => {
  protocol.delayed = true; const backend = setup(), controller = new AbortController();
  const capture = backend.captureDisplay({ ...request, signal: controller.signal });
  void capture.catch(() => {});
  await vi.waitFor(() => expect(protocol.deliver).not.toBeNull());
  controller.abort(Error('cancelled')); await expect(capture).rejects.toThrow('cancelled');
  protocol.deliver!();
  await vi.waitFor(() => expect(protocol.writes.some(r => r.command === 'release')).toBe(true));
});

it('preserves accepted originals and helper health when the cache is full', async () => {
  const backend = setup(), frame = await backend.captureDisplay(request);
  protocol.full = true;
  await expect(backend.captureDisplay({ ...request, performanceSessionId: 'session-two' })).rejects.toThrow('cache is full');
  expect(await backend.isAvailable()).toBe(true);
  expect(backend.status().helperRestarts).toBe(0);
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  expect((await frame.original!.png(rect, new AbortController().signal)).length).toBe(24);
  frame.original!.release();
});
