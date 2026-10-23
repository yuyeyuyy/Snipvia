import { describe, expect, it, vi } from 'vitest';
import { CaptureModeRouter } from '../../src/main/capture/CaptureModeRouter';
import { normalizeCaptureMode, reservedCaptureShortcuts } from '../../src/shared/capture-mode';

describe('CaptureModeRouter', () => {
  it('routes only to the selected local handler and never creates a conversation', async () => {
    const quick = vi.fn(async () => {}), edit = vi.fn(async () => {});
    const router = new CaptureModeRouter<number>({ quick, edit });
    const first = router.begin('one', 'quick'); await router.complete({ sessionId: first.id, value: 1 });
    const second = router.begin('two', 'edit'); await router.complete({ sessionId: second.id, value: 2 });
    expect(quick).toHaveBeenCalledWith({ sessionId: 'one', value: 1 }, first);
    expect(edit).toHaveBeenCalledWith({ sessionId: 'two', value: 2 }, second);
    await expect(router.complete({ sessionId: 'two', value: 3 })).rejects.toThrow('已失效');
  });
  it('rejects collect before cancelling the active mode and reserves unavailable commands only', () => {
    const router = new CaptureModeRouter({ quick: async () => {}, edit: async () => {} });
    const session = router.begin('one', 'quick');
    expect(() => router.begin('two', 'collect')).toThrow('尚未实现');
    expect(session.signal.aborted).toBe(false);
    expect(router.current('one')).toBe(session);
    expect(reservedCaptureShortcuts.filter(item => item.available).map(item => item.id)).toEqual(['quick', 'collect', 'open-collection', 'clear-collection', 'edit']);
    expect(normalizeCaptureMode('ai')).toBe('quick'); expect(normalizeCaptureMode('standard')).toBe('edit');
    expect(() => normalizeCaptureMode('invalid')).toThrow();
  });
  it('isolates superseded sessions and refuses duplicate finishes during asynchronous output', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const router = new CaptureModeRouter({ quick: async () => pending, edit: async () => {} });
    const old = router.begin('old', 'quick');
    const finishing = router.complete({ sessionId: 'old', value: 1 });
    await expect(router.complete({ sessionId: 'old', value: 1 })).rejects.toThrow('正在完成');
    router.begin('new', 'edit'); router.cancel('old');
    expect(old.signal.aborted).toBe(true); expect(router.current('new')?.mode).toBe('edit');
    release(); await expect(finishing).rejects.toThrow('已结束');
    expect(router.current('new')?.mode).toBe('edit');
    await expect(router.complete({ sessionId: 'old', value: 2 })).rejects.toThrow('已失效');
    await router.complete({ sessionId: 'new', value: 3 });
  });
  it('keeps a cancelled save dialog retryable and resets a failed output', async () => {
    let cancel = true;
    const router = new CaptureModeRouter({ quick: async () => {}, edit: async () => { if (cancel) return false; throw new Error('disk failure'); } });
    router.begin('one', 'edit');
    expect(await router.complete({ sessionId: 'one', value: 0 })).toBe(false);
    expect(router.current('one')).toBeTruthy(); cancel = false;
    await expect(router.complete({ sessionId: 'one', value: 1 })).rejects.toThrow('disk failure');
    expect(router.current('one')).toBeTruthy(); router.cancel();
    expect(router.current('one')).toBeNull();
  });
});
