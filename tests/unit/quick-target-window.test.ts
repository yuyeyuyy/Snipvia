import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { screen: { getCursorScreenPoint: () => ({ x: -1000, y: -1000 }) }, BrowserWindow: class extends EventEmitter {
    destroyed = false; visible = false; focused = false; opacity = 1; ignored = false; calls: string[] = []; bounds = { x: 0, y: 0, width: 520, height: 142 };
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), focus: vi.fn() });
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isFocused() { return this.focused; }
    setVisibleOnAllWorkspaces() {} setFocusable() {} getBounds() { return this.bounds; } setBounds(value: typeof this.bounds) { this.bounds = value; }
    setOpacity(value: number) { this.opacity = value; } setIgnoreMouseEvents(value: boolean) { this.ignored = value; }
    hide() { this.calls.push('hide'); this.visible = false; this.focused = false; }
    showInactive() { this.calls.push('showInactive'); this.visible = true; }
    show() { this.visible = true; } focus() { this.focused = true; }
    destroy() { this.destroyed = true; }
  } };
});
import { QuickTargetWindow } from '../../src/main/windows/QuickTargetWindow';
afterEach(() => vi.useRealTimers());
const area = { x: 0, y: 0, width: 1000, height: 800 };
const state = { presentationId: 1, visible: true, busy: false, error: '', targets: [] };
type Probe = { calls: string[]; opacity: number; ignored: boolean; focused: boolean; webContents: { emit(event: string): void }; destroyed: boolean };
it('shows only after its current ACK, suspends without native hide, and rejects late ACKs', async () => {
  const window = new QuickTargetWindow({}, async () => {}, vi.fn()); await window.prepare(); window.markReady();
  const native = window.peekWindow() as unknown as Probe;
  window.present(state, area); expect(native.calls).not.toContain('showInactive'); expect(window.rendered(0)).toBe(false);
  expect(window.rendered(1)).toBe(true); expect(native.calls).toContain('showInactive');
  native.calls.length = 0; window.suspend(); expect(native.opacity).toBe(0); expect(native.ignored).toBe(true); expect(native.calls).not.toContain('hide'); expect(window.rendered(1)).toBe(false);
  expect(window.hasPointerInteraction()).toBe(false); window.destroy();
});
it('does not let a failed old preload destroy a newly enabled window', async () => {
  let rejectOld!: (error: Error) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; })).mockResolvedValue(undefined);
  const window = new QuickTargetWindow({}, load, vi.fn()); const old = window.prepare(); const first = window.peekWindow(); window.destroy();
  await window.prepare(); const replacement = window.peekWindow(); expect(replacement).not.toBe(first); window.markReady();
  rejectOld(new Error('stale')); await old; expect(window.peekWindow()).toBe(replacement); expect(window.isReady()).toBe(true); window.destroy();
});
it('protects explicitly focused keyboard selection and tears down stalled renderer presentations', async () => {
  vi.useFakeTimers(); const failed = vi.fn(); const window = new QuickTargetWindow({}, async () => {}, failed); await window.prepare(); window.markReady();
  window.present(state, area); window.rendered(1); window.focus(); expect(window.hasPointerInteraction()).toBe(true);
  window.present({ ...state, presentationId: 2 }, area); await vi.advanceTimersByTimeAsync(1500); expect(failed).toHaveBeenCalledOnce(); window.destroy();
});

it('keeps an expanded tab chooser inside narrow or short work areas', async () => {
  const window = new QuickTargetWindow({}, async () => {}, vi.fn()); await window.prepare(); window.markReady();
  const small = { x: -300, y: -40, width: 300, height: 200 };
  window.present(state, small);
  window.update({ ...state, notice: '选择标签', choices: Array.from({ length: 32 }, (_, index) => ({ id: String(index), title: 'Synthetic', detail: 'Chrome' })) });
  const bounds = window.peekWindow()!.getBounds();
  expect(bounds.x).toBeGreaterThanOrEqual(small.x); expect(bounds.width).toBeLessThanOrEqual(small.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(small.y + small.height); window.destroy();
});
