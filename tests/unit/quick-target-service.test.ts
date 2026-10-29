import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QuickTargetService } from '../../src/main/quick-target/QuickTargetService';
import { defaultQuickTargetPreferences, type QuickTarget } from '../../src/shared/quick-target';

afterEach(() => vi.useRealTimers());
it('updates artwork without resetting presentation, hover lifetime, selection or focus', async () => {
  const { service, options, offer, id } = fixture(); const presentation = await offer();
  await vi.advanceTimersByTimeAsync(1000);
  service.updateArtwork([{ id, kind: 'website', label: 'Example', detail: '打开网页', icon: 'local-png', browserIcon: 'browser-png' }]);
  expect(service.current()).toMatchObject({ visible: true, presentationId: presentation, targets: [{ icon: 'local-png', browserIcon: 'browser-png' }] });
  expect(options.present).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000); expect(service.current().visible).toBe(false);
  const updates = options.update.mock.calls.length; service.updateArtwork([]); expect(options.update).toHaveBeenCalledTimes(updates); service.dispose();
});
function fixture() {
  vi.useFakeTimers();
  const id = randomUUID(), target = { id, kind: 'website' as const, label: 'Example', url: 'https://example.test/' };
  const config = { ...defaultQuickTargetPreferences, enabled: true, targets: [target] };
  const options = { preferences: () => config, views: () => [{ id, kind: 'website' as const, label: 'Example', detail: '打开网页' }], clipboardMatches: vi.fn(async () => true), ready: vi.fn(() => true), present: vi.fn(), update: vi.fn(), hide: vi.fn(), activate: vi.fn(async (_target: QuickTarget, _launch: boolean, signal: AbortSignal) => { signal.throwIfAborted(); }) };
  const service = new QuickTargetService(options);
  const offer = async (capture = 'capture', marker = 'marker') => { service.beginCapture(capture); service.copied(capture, marker, { x: 0, y: 0, width: 1000, height: 800 }); await vi.advanceTimersByTimeAsync(0); return service.current().presentationId; };
  return { service, config, options, id, offer };
}
it('offers only a current copied result and activates only the registered target after clipboard verification', async () => {
  const { service, options, offer, id } = fixture();
  const presentation = await offer(); expect(service.current().visible).toBe(true); expect(options.present).toHaveBeenCalledOnce();
  await service.activate(presentation, id); expect(options.activate).toHaveBeenCalledOnce(); expect(service.current().visible).toBe(false);
  expect(service.protectsActivation()).toBe(true); service.dispose();
});
it('offers an independent shelf copy on its own display after the clipboard commits', async () => {
  const { service, options, id } = fixture();
  service.beginCopy('shelf-single');
  expect(service.current().visible).toBe(false); expect(options.present).not.toHaveBeenCalled();
  expect(options.hide).toHaveBeenLastCalledWith(false);
  const area = { x: -1440, y: -200, width: 1440, height: 900 };
  service.copied('shelf-single', 'shelf-marker', area); await vi.advanceTimersByTimeAsync(0);
  expect(options.clipboardMatches).toHaveBeenCalledWith('shelf-marker');
  expect(options.present).toHaveBeenLastCalledWith(service.current(), area);
  await service.activate(service.current().presentationId, id);
  expect(options.activate).toHaveBeenCalledOnce(); expect(service.current().visible).toBe(false); service.dispose();
});
it('invalidates delayed copies across shelf copies and new captures in both directions', async () => {
  const { service, options } = fixture(), area = { x: 0, y: 0, width: 1000, height: 800 };
  let finish!: (value: boolean) => void;
  options.clipboardMatches.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  service.beginCopy('shelf-all'); service.copied('shelf-all', 'all-marker', area); await vi.advanceTimersByTimeAsync(0);
  service.beginCapture('capture'); finish(true); await vi.advanceTimersByTimeAsync(0);
  expect(options.present).not.toHaveBeenCalled();
  service.beginCopy('shelf-merge'); service.copied('capture', 'capture-marker', area); await vi.advanceTimersByTimeAsync(0);
  expect(options.present).not.toHaveBeenCalled();
  service.beginCopy('shelf-latest'); service.copied('shelf-merge', 'merge-marker', area); await vi.advanceTimersByTimeAsync(0);
  expect(options.present).not.toHaveBeenCalled();
  service.copied('shelf-latest', 'latest-marker', area); await vi.advanceTimersByTimeAsync(0);
  expect(options.present).toHaveBeenCalledOnce(); service.dispose();
});
it('skips disabled, unconfigured and unready windows rather than loading UI on the output path', async () => {
  const { service, config, options, offer } = fixture();
  config.enabled = false; await offer(); expect(options.present).not.toHaveBeenCalled();
  config.enabled = true; options.ready.mockReturnValue(false); await offer(); expect(options.clipboardMatches).not.toHaveBeenCalled();
  options.ready.mockReturnValue(true); config.targets = []; await offer(); expect(options.present).not.toHaveBeenCalled(); service.dispose();
});
it('invalidates delayed A when B starts or is canceled and ignores old retries', async () => {
  const { service, options } = fixture();
  let finish!: (value: boolean) => void;
  options.clipboardMatches.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  service.beginCapture('a'); service.copied('a', 'a-marker', { x: 0, y: 0, width: 1000, height: 800 }); await vi.advanceTimersByTimeAsync(0);
  service.beginCapture('b'); service.dismiss(); finish(true); await vi.advanceTimersByTimeAsync(0);
  service.copied('a', 'a-marker', { x: 0, y: 0, width: 1000, height: 800 }); await vi.advanceTimersByTimeAsync(0);
  expect(options.present).not.toHaveBeenCalled(); service.dispose();
});
it('isolates failed UI from successful output and stops stale offers after dispose', async () => {
  const { service, options, offer } = fixture(); options.present.mockImplementation(() => { throw new Error('Renderer unavailable'); });
  await expect(offer()).resolves.toBeTypeOf('number'); expect(service.current().visible).toBe(false);
  service.beginCapture('c'); service.copied('c', 'marker', { x: 0, y: 0, width: 1, height: 1 }); service.dispose(); await vi.advanceTimersByTimeAsync(0);
  expect(service.current().visible).toBe(false);
});
it('rejects stale presentation and forged target IDs without activating anything', async () => {
  const { service, options, offer, id } = fixture(); const presentation = await offer();
  await expect(service.activate(presentation - 1, id)).rejects.toThrow('过期'); await expect(service.activate(presentation, randomUUID())).rejects.toThrow('移除');
  expect(options.activate).not.toHaveBeenCalled(); service.dispose();
});
it('dismisses when clipboard is overwritten and never restores the screenshot', async () => {
  const { service, options, offer, id } = fixture(); const presentation = await offer(); options.clipboardMatches.mockResolvedValue(false);
  await expect(service.activate(presentation, id)).rejects.toThrow('剪贴板'); expect(options.activate).not.toHaveBeenCalled(); expect(service.current().visible).toBe(false);
  await offer(); expect(service.current().visible).toBe(false); service.dispose();
});
it('checks metadata while visible, stops after hide and preserves the remaining hover timeout', async () => {
  const { service, options, offer } = fixture(); const presentation = await offer();
  await vi.advanceTimersByTimeAsync(1000); service.interaction(presentation, true); await vi.advanceTimersByTimeAsync(6000); expect(service.current().visible).toBe(true);
  service.interaction(presentation, false); await vi.advanceTimersByTimeAsync(2999); expect(service.current().visible).toBe(true);
  await vi.advanceTimersByTimeAsync(1); expect(service.current().visible).toBe(false);
  const count = options.clipboardMatches.mock.calls.length; await vi.advanceTimersByTimeAsync(2000); expect(options.clipboardMatches).toHaveBeenCalledTimes(count); service.dispose();
});
it('automatically closes on clipboard changes without polling when hidden', async () => {
  const { service, options, offer } = fixture(); await offer(); options.clipboardMatches.mockResolvedValue(false);
  await vi.advanceTimersByTimeAsync(750); expect(service.current().visible).toBe(false); service.dispose();
});
it('cancels an in-flight activation on the next capture and suppresses late failure UI', async () => {
  const { service, options, offer, id } = fixture(); const presentation = await offer(); let release!: () => void; let signal!: AbortSignal;
  options.activate.mockImplementationOnce(async (_target, _launch, value) => { signal = value; await new Promise<void>(resolve => { release = resolve; }); value.throwIfAborted(); });
  const activation = service.activate(presentation, id); await vi.advanceTimersByTimeAsync(0); expect(service.current().busy).toBe(true);
  await expect(service.activate(presentation, id)).rejects.toThrow('正在切换');
  service.beginCapture('next'); expect(signal.aborted).toBe(true); release(); await expect(activation).rejects.toThrow();
  expect(service.current().visible).toBe(false); service.dispose();
});
it('leaves a bounded failure message and cancels hung native work at the deadline', async () => {
  const { service, options, offer, id } = fixture(); const presentation = await offer();
  options.activate.mockImplementationOnce(async (_target, _launch, signal) => { await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); });
  const activation = service.activate(presentation, id); const rejected = expect(activation).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(5000); await rejected; expect(service.current().error).toContain('截图仍在剪贴板'); expect(service.current().busy).toBe(false); service.dispose();
});

it('keeps explicit tab choices in the current presentation and rejects forged choices before dispatch', async () => {
  const { options, config, id } = fixture();
  const choice = { id: randomUUID(), title: 'Synthetic chat', detail: 'Chrome' };
  const activate = vi.fn(async () => ({ kind: 'choose' as const, choices: [choice] }));
  const service = new QuickTargetService({ ...options, preferences: () => config, activate });
  service.beginCapture('one'); service.copied('one', 'marker', { x: 0, y: 0, width: 800, height: 600 }); await vi.advanceTimersByTimeAsync(0);
  const presentation = service.current().presentationId;
  await service.activate(presentation, id); expect(service.current().choices).toEqual([choice]);
  expect(service.current().visible).toBe(true); expect(service.current().busy).toBe(false);
  await expect(service.activate(presentation, id, randomUUID())).rejects.toThrow('过期'); expect(activate).toHaveBeenCalledTimes(1);
  await service.activate(presentation, id, choice.id); expect(activate).toHaveBeenCalledTimes(2);
  service.beginCapture('two'); expect(service.current().choices).toBeUndefined(); service.dispose();
});
it('quietly closes a successful switch when optional composer focus fails, without erasing the clipboard', async () => {
  const { options, config, id } = fixture();
  const service = new QuickTargetService({ ...options, preferences: () => config, activate: async () => ({ kind: 'manual', message: '请手动点击输入框' }) });
  service.beginCapture('one'); service.copied('one', 'marker', { x: 0, y: 0, width: 800, height: 600 }); await vi.advanceTimersByTimeAsync(0);
  await service.activate(service.current().presentationId, id);
  expect(service.current()).toMatchObject({ visible: false, busy: false, error: '' });
  expect(service.current().notice).toBeUndefined();
  const clipboardReads = options.clipboardMatches.mock.calls.length;
  await vi.advanceTimersByTimeAsync(4000); expect(options.clipboardMatches).toHaveBeenCalledTimes(clipboardReads); service.dispose();
});
