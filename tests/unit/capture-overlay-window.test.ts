import { expect, it, vi } from 'vitest';
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { BrowserWindow: class extends EventEmitter {
    opacity = 0; ignored = true; ordered = false; occluded = false; focused = false; calls: string[] = [];
    webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
    constructor(public options: object) { super(); }
    isDestroyed() { return false; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; }
    setBounds() {}
    setOpacity(value: number) { this.opacity = value; }
    setIgnoreMouseEvents(value: boolean) { this.ignored = value; }
    isVisible() { return this.ordered && !this.occluded; }
    isFocused() { return this.focused; }
    show() { this.calls.push('show'); this.ordered = true; this.focused = true; }
    hide() { this.calls.push('hide'); this.ordered = false; this.focused = false; }
    focus() { this.calls.push('focus'); this.focused = true; }
  } };
});
import { CaptureOverlayWindow } from '../../src/main/windows/capture-overlay-window';
type Probe = { opacity: number; ignored: boolean; ordered: boolean; occluded: boolean; focused: boolean; calls: string[] };
const bounds = { x: 0, y: 0, width: 800, height: 600 };
async function setup() {
  const overlay = new CaptureOverlayWindow({}, async () => { overlay.markRendererReady(); }, 'startup', () => {});
  await overlay.create(bounds);
  return { overlay, native: overlay.getWindow() as unknown as Probe };
}
it('wakes the native window before any renderer/image ACK, revealing only the reset shell', async () => {
  const { overlay, native } = await setup();
  await overlay.prepare('one', bounds);
  expect(native.calls).toEqual(['show']); expect(native.focused).toBe(true);
  expect(native.opacity).toBe(0); expect(native.ignored).toBe(true);
  expect(overlay.showShellSession('stale')).toBe(false);
  expect(native.opacity).toBe(0);
  expect(overlay.showShellSession('one')).toBe(true);
  expect(native.opacity).toBe(1); expect(native.ignored).toBe(false);
  // The full preview may still be unavailable; input no longer waits for it.
});
it('orders out an app-hidden/occluded window once and can wake it for the next capture', async () => {
  const { overlay, native } = await setup();
  await overlay.prepare('one', bounds); overlay.showShellSession('one');
  native.occluded = true;
  overlay.hide(); overlay.hide();
  expect(native.calls).toEqual(['show', 'hide']);
  expect(native.opacity).toBe(0); expect(native.ignored).toBe(true);
  await overlay.prepare('two', bounds);
  expect(native.calls).toEqual(['show', 'hide', 'show']);
  expect(overlay.showShellSession('one')).toBe(false);
  expect(overlay.showShellSession('two')).toBe(true);
});
it('blocks late shell/render ACKs while Electron fallback is capturing its background', async () => {
  const { overlay, native } = await setup();
  await overlay.prepare('one', bounds); overlay.suspendForCapture();
  expect(overlay.showShellSession('one')).toBe(false);
  expect(overlay.showRenderedSession('one')).toBe(false);
  expect(native.ordered).toBe(false); expect(native.opacity).toBe(0); expect(native.ignored).toBe(true);
  overlay.frameReady('one'); expect(overlay.showRenderedSession('one')).toBe(true);
  expect(native.ordered).toBe(true); expect(native.opacity).toBe(1); expect(native.ignored).toBe(false);
});
