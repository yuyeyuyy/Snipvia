import { desktopCapturer, screen, type BrowserWindow } from 'electron';
import { waitForCaptureReadiness, type CaptureReadinessStrategy } from './capture-readiness';
import { selectDesktopScreenSource } from './desktop-source-selection';
import { validateScreenThumbnailSize } from './thumbnail-size';
import type { CaptureBackend, CaptureBackendRequest, CapturedFrame } from './types';

type ElectronCaptureBackendOptions = {
  getMainWindow: () => BrowserWindow;
  permissionHelp: () => string;
  readinessDelayMs: () => number;
  readinessStrategy: () => CaptureReadinessStrategy;
  waitForWarmup: () => Promise<void>;
  mark: (sessionId: string, event: 'capture_warmup_wait_start' | 'capture_warmup_wait_end' | 'capture_readiness_start' | 'main_window_hide_called' | 'main_window_hidden' | 'capture_readiness_end' | 'frame_capture_start' | 'frame_capture_end', metadata?: Record<string, string | number | boolean>) => void;
};

export class ElectronCaptureBackend implements CaptureBackend {
  readonly name = 'electron' as const;

  constructor(private readonly options: ElectronCaptureBackendOptions) {}

  async initialize() {
    await this.options.waitForWarmup();
  }

  async isAvailable() {
    return true;
  }

  async captureDisplay(request: CaptureBackendRequest): Promise<CapturedFrame> {
    const { display, performanceSessionId } = request;
    request.signal?.throwIfAborted();
    this.options.mark(performanceSessionId, 'capture_warmup_wait_start');
    await this.options.waitForWarmup();
    request.signal?.throwIfAborted();
    this.options.mark(performanceSessionId, 'capture_warmup_wait_end');
    const readinessDelay = this.options.readinessDelayMs();
    const readinessStrategy = this.options.readinessStrategy();
    this.options.mark(performanceSessionId, 'capture_readiness_start', { delayMs: readinessDelay, strategy: readinessStrategy });
    await waitForCaptureReadiness({
      window: this.options.getMainWindow(),
      strategy: readinessStrategy,
      fallbackDelayMs: readinessDelay,
      onHideCalled: () => this.options.mark(performanceSessionId, 'main_window_hide_called', { wasVisible: request.mainWindowWasVisible }),
      onHidden: () => this.options.mark(performanceSessionId, 'main_window_hidden')
    });
    request.signal?.throwIfAborted();
    this.options.mark(performanceSessionId, 'capture_readiness_end');
    this.options.mark(performanceSessionId, 'frame_capture_start', { backend: this.name });
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      fetchWindowIcons: false,
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor)
      }
    });
    request.signal?.throwIfAborted();
    if (process.platform === 'win32') {
      const current = screen.getAllDisplays().find((item) => String(item.id) === display.id);
      if (!current || current.scaleFactor !== display.scaleFactor
        || current.bounds.x !== display.bounds.x || current.bounds.y !== display.bounds.y
        || current.size.width !== display.size.width || current.size.height !== display.size.height) {
        throw new Error('Windows 显示器或缩放比例已变化，请重新截图。');
      }
    }
    const displayCount = screen.getAllDisplays().length;
    const source = selectDesktopScreenSource(sources, display.id, process.platform, displayCount);
    const size = source?.thumbnail.getSize();
    const expectedWidth = Math.round(display.size.width * display.scaleFactor);
    const expectedHeight = Math.round(display.size.height * display.scaleFactor);
    this.options.mark(performanceSessionId, 'frame_capture_end', {
      backend: this.name,
      sourceCount: sources.length,
      displayCount,
      missingDisplayIds: sources.filter((item) => !item.display_id).length,
      sourceMatched: Boolean(source),
      expectedWidth,
      expectedHeight,
      ...(size ? { actualWidth: size.width, actualHeight: size.height } : {})
    });
    if (!source) {
      if (process.platform === 'win32') {
        if (sources.length === 0) {
          throw new Error('Windows 没有返回屏幕源。请确认桌面未锁定、未停留在 UAC 安全桌面，然后重新打开截然。');
        }
        throw new Error(`Windows 已返回 ${sources.length} 个屏幕源，但无法确定当前显示器。请暂时只连接一台显示器再截图，并反馈显示器数量。`);
      }
      throw new Error(this.options.permissionHelp());
    }
    if (source.thumbnail.isEmpty()) {
      throw new Error(process.platform === 'win32'
        ? 'Windows 已找到屏幕，但未返回画面。请确认桌面未锁定、未停留在 UAC 安全桌面，然后重试。'
        : this.options.permissionHelp());
    }
    if (!size) throw new Error('屏幕帧尺寸无效，请重新截图');
    validateScreenThumbnailSize(size, display, process.platform);
    return {
      width: size.width,
      height: size.height,
      scaleFactor: display.scaleFactor,
      displayId: display.id,
      capturedAt: Date.now(),
      format: 'bgra',
      image: source.thumbnail
    };
  }

  async invalidateDisplays() {}

  async dispose() {}
}
