import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import type { PinnedCaptureState } from '../../src/shared/contracts';

const runtime = vi.hoisted(() => ({ windows: [] as {
  sender: WebContents; close: () => void; destroyed: boolean;
  create: ReturnType<typeof vi.fn>; present: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>;
  suspend: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>;
}[] }));
vi.mock('../../src/main/windows/screenshot-to-all-window', () => ({
  ScreenshotToAllWindow: class {
    sender = { id: runtime.windows.length + 1 } as WebContents;
    destroyed = false;
    close: () => void;
    create = vi.fn(async () => {});
    present = vi.fn(async () => true);
    hide = vi.fn();
    destroy = vi.fn(() => { this.destroyed = true; });
    suspend = vi.fn();
    resume = vi.fn();
    constructor(_preferences: unknown, _loader: unknown, _id: unknown, _move: unknown, close: () => void) {
      this.close = close; runtime.windows.push(this);
    }
    peekWindow() { return this.destroyed ? null : { webContents: this.sender, isFocused: () => false }; }
    markRendererReady() {}
    showRenderedSession() { return true; }
    markSessionVisible() { return true; }
  }
}));
import { PinnedCaptureWindows } from '../../src/main/windows/PinnedCaptureWindows';
const bounds = { x: 30, y: 30, width: 300, height: 200 };
const state = { performanceSessionId: 'test' } as PinnedCaptureState;
function fixture() {
  const closed: string[] = [];
  const manager = new PinnedCaptureWindows({}, async () => {}, 'startup', id => { closed.push(id); manager.close(id); });
  return { manager, closed };
}
beforeEach(() => { runtime.windows = []; });
describe('independent pin ownership', () => {
  it('keeps separate senders, rejects another pin session ACK and reuses only the idle primary', async () => {
    const { manager } = fixture();
    await manager.present('one', bounds, state); await manager.present('two', bounds, state);
    const [one, two] = runtime.windows;
    expect(manager.sessionForSender(one.sender)).toBe('one'); expect(manager.sessionForSender(two.sender)).toBe('two');
    expect(manager.showRenderedSession('two', one.sender)).toBe(false);
    expect(manager.markSessionVisible('one', two.sender)).toBe(false);
    expect(manager.showRenderedSession('two', two.sender)).toBe(true);
    manager.close('one'); expect(one.hide).toHaveBeenCalledOnce(); expect(two.destroyed).toBe(false);
    await manager.present('three', bounds, state); expect(runtime.windows).toHaveLength(2);
    expect(manager.sessionForSender(one.sender)).toBe('three');
    manager.close('two'); expect(two.destroyed).toBe(true); expect(manager.forSender(two.sender)).toBeUndefined();
    manager.destroy();
  });
  it('suspends and resumes every pin without releasing its session; native close affects only its owner', async () => {
    const { manager, closed } = fixture();
    await manager.present('one', bounds, state); await manager.present('two', bounds, state);
    manager.suspend(); manager.suspend();
    for (const window of runtime.windows) expect(window.suspend).toHaveBeenCalledOnce();
    expect(manager.sessionForSender(runtime.windows[0].sender)).toBe('one');
    manager.resume();
    for (const window of runtime.windows) expect(window.resume).toHaveBeenCalledOnce();
    runtime.windows[1].close();
    expect(closed).toEqual(['two']); expect(manager.isActive()).toBe(true);
    expect(manager.sessionForSender(runtime.windows[0].sender)).toBe('one');
    manager.destroy(); expect(closed).toEqual(['two', 'one']);
  });
  it('rolls back only a failing window and bounds active windows without closing existing pins', async () => {
    const { manager, closed } = fixture();
    runtime.windows[0].create.mockRejectedValueOnce(new Error('synthetic load failure'));
    await expect(manager.present('failed', bounds, state)).rejects.toThrow('synthetic load failure');
    expect(closed).toEqual(['failed']); expect(manager.isActive()).toBe(false);
    for (let i = 0; i < 32; i++) await manager.present('pin' + i, bounds, state);
    await expect(manager.present('overflow', bounds, state)).rejects.toThrow('32');
    expect(manager.sessionForSender(runtime.windows[0].sender)).toBe('pin0');
    expect(runtime.windows.filter(window => !window.destroyed)).toHaveLength(32);
    manager.destroy(); expect(runtime.windows.every(window => window.destroyed)).toBe(true);
  });
});
