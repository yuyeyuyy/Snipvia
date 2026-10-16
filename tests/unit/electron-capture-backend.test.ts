import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronCaptureBackend } from '../../src/main/capture/electron-capture-backend';
import type { CaptureBackendRequest } from '../../src/main/capture/types';

const mocks = vi.hoisted(() => ({ getSources: vi.fn(), getAllDisplays: vi.fn(), readiness: vi.fn() }));
vi.mock('electron', () => ({ desktopCapturer: { getSources: mocks.getSources }, screen: { getAllDisplays: mocks.getAllDisplays } }));
vi.mock('../../src/main/capture/capture-readiness', () => ({ waitForCaptureReadiness: mocks.readiness }));

const display = { id: '42', bounds: { x: -1536, y: 0, width: 1536, height: 864 }, size: { width: 1536, height: 864 }, scaleFactor: 1.25 };
const request: CaptureBackendRequest = { display, performanceSessionId: 'synthetic-session', mainWindowWasVisible: true };
const image = { isEmpty: () => false, getSize: () => ({ width: 1920, height: 1080 }) };
const source = { id: 'screen:1:0', display_id: '42', thumbnail: image };
function backend(warmup: () => Promise<void> = async () => {}) {
  return new ElectronCaptureBackend({ getMainWindow: vi.fn(), permissionHelp: () => 'permission error', readinessDelayMs: () => 200,
    readinessStrategy: () => 'hide-event-16', waitForWarmup: warmup, mark: vi.fn() });
}

describe('Windows Electron capture backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    mocks.getAllDisplays.mockReturnValue([{ ...display, id: 42 }, { ...display, id: 17 }]);
    mocks.getSources.mockResolvedValue([{ ...source, display_id: '17' }, source]);
    mocks.readiness.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests physical pixels and matches a monitor with negative desktop coordinates', async () => {
    const frame = await backend().captureDisplay(request);
    expect(mocks.getSources).toHaveBeenCalledWith({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 1920, height: 1080 } });
    expect(frame).toMatchObject({ displayId: '42', width: 1920, height: 1080, image });
  });
  it('does not hide windows or enumerate sources after cancellation during warmup', async () => {
    const controller = new AbortController();
    await expect(backend(async () => { controller.abort(new Error('cancelled')); }).captureDisplay({ ...request, signal: controller.signal })).rejects.toThrow('cancelled');
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled();
  });
  it('discards an in-flight frame after cancellation', async () => {
    const controller = new AbortController();
    mocks.getSources.mockImplementation(async () => { controller.abort(new Error('cancelled')); return [source]; });
    await expect(backend().captureDisplay({ ...request, signal: controller.signal })).rejects.toThrow('cancelled');
  });
  it('rejects a display scaling change during capture', async () => {
    mocks.getAllDisplays.mockReturnValue([{ ...display, id: 42, scaleFactor: 1.5 }]);
    await expect(backend().captureDisplay(request)).rejects.toThrow('缩放比例已变化');
  });
  it('reports missing and empty frames without guessing a monitor', async () => {
    mocks.getSources.mockResolvedValue([]);
    await expect(backend().captureDisplay(request)).rejects.toThrow('没有返回屏幕源');
    mocks.getSources.mockResolvedValue([{ ...source, thumbnail: { ...image, isEmpty: () => true } }]);
    await expect(backend().captureDisplay(request)).rejects.toThrow('未返回画面');
    mocks.getSources.mockResolvedValue([{ ...source, display_id: '' }]);
    await expect(backend().captureDisplay(request)).rejects.toThrow('无法确定当前显示器');
  });
});
