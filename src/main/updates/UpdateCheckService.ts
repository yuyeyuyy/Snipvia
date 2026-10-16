import { z } from 'zod';
import type { UpdateState } from '../../shared/updates';
import type { UpdateInstaller } from './UpdateInstaller';
import releaseSource from '../../shared/release-source.json';

export const releaseRepository = releaseSource.repository;
export const latestReleaseEndpoint = `https://api.github.com/repos/${releaseRepository}/releases/latest`;
const maximumResponseBytes = 256 * 1024;
const releaseSchema = z.object({
  tag_name: z.string().min(1).max(120),
  draft: z.literal(false),
  prerelease: z.literal(false),
  body: z.string().nullable().optional(),
  published_at: z.string().datetime({ offset: true })
});

function parseVersion(value: string) {
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  const parts = match[1].split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  return { version: match[1], parts, prerelease: !!match[2] };
}

export function isNewerStableVersion(latest: string, current: string) {
  const next = parseVersion(latest), installed = parseVersion(current);
  if (!next || next.prerelease || !installed) throw new Error('发布版本号格式无效');
  for (let index = 0; index < 3; index++) {
    if (next.parts[index] !== installed.parts[index]) return next.parts[index] > installed.parts[index];
  }
  return installed.prerelease;
}

class UpdateCheckError extends Error {}

async function readRelease(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new UpdateCheckError('更新信息为空，请稍后重试');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumResponseBytes) throw new UpdateCheckError('更新信息过大，无法验证');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new UpdateCheckError('更新信息无效，未找到可验证的正式版本'); }
  const parsed = releaseSchema.safeParse(value);
  if (!parsed.success || !parseVersion(parsed.data.tag_name) || parseVersion(parsed.data.tag_name)?.prerelease) {
    throw new UpdateCheckError('更新信息无效，未找到可验证的正式版本');
  }
  return parsed.data;
}

/** Main-owned version discovery and explicitly requested download/install state. */
export class UpdateCheckService {
  private state: UpdateState;
  private inFlight: Promise<UpdateState> | null = null;
  private controller: AbortController | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private downloadTask: Promise<UpdateState> | null = null;
  private installTask: Promise<UpdateState> | null = null;
  private releaseTag: string | null = null;

  constructor(private readonly options: {
    currentVersion: string;
    onChanged(state: UpdateState): void;
    openExternal(url: string): Promise<void>;
    fetcher?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
    installer?: UpdateInstaller;
    prepareInstall?: () => Promise<void>;
  }) {
    this.state = { status: 'idle', currentVersion: options.currentVersion, latestVersion: null, checkedAt: null, releaseUrl: null, releaseNotes: null, error: null,
      downloadSupported: options.installer?.supported ?? false,
      downloadUnavailableReason: options.installer?.supported ? null : options.installer?.unavailableReason ?? '当前安装包仅支持检查版本', downloadProgress: null };
  }

  current() { return { ...this.state }; }

  scheduleStartup(enabled: boolean, delayMs = 10_000) {
    if (!enabled || this.disposed || this.startupTimer) return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      // A manual check before the timer fires already fulfills the startup check.
      if (this.state.status === 'idle') void this.check();
    }, delayMs);
    this.startupTimer.unref();
  }

  check(): Promise<UpdateState> {
    if (this.disposed) return Promise.resolve(this.current());
    if (['downloading', 'downloaded', 'installing'].includes(this.state.status)) return Promise.resolve(this.current());
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performCheck().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async openRelease() {
    if (!this.state.releaseUrl) throw new Error('请先检查是否有新版本');
    await this.options.openExternal(this.state.releaseUrl);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.startupTimer);
    this.controller?.abort();
    this.options.installer?.dispose();
  }

  download(): Promise<UpdateState> {
    if (this.downloadTask) return this.downloadTask;
    if (this.state.status === 'downloaded') return Promise.resolve(this.current());
    if (this.disposed || this.state.status !== 'available' || !this.releaseTag || !this.state.latestVersion) return Promise.reject(new Error('请先检查新版本'));
    if (!this.state.downloadSupported || !this.options.installer) return Promise.reject(new Error(this.state.downloadUnavailableReason ?? '此安装包无法自动更新'));
    const installer = this.options.installer, version = this.state.latestVersion, tag = this.releaseTag;
    this.publish({ ...this.state, status: 'downloading', downloadProgress: 0, error: null });
    this.downloadTask = installer.download(version, tag, percent => {
      if (!this.disposed && this.state.status === 'downloading' && Number.isFinite(percent)) {
        this.publish({ ...this.state, downloadProgress: Math.min(100, Math.max(0, Math.floor(percent))) });
      }
    }).then(() => {
      if (!this.disposed) this.publish({ ...this.state, status: 'downloaded', downloadProgress: 100, error: null });
      return this.current();
    }).catch(() => {
      if (!this.disposed) this.publish({ ...this.state, status: 'available', downloadProgress: null, error: '下载或校验失败，请检查网络与正式发布文件后重试' });
      return this.current();
    }).finally(() => { this.downloadTask = null; });
    return this.downloadTask;
  }

  restartAndInstall(): Promise<UpdateState> {
    if (this.installTask) return this.installTask;
    if (this.disposed || this.state.status !== 'downloaded' || !this.options.installer || !this.options.prepareInstall) return Promise.reject(new Error('请先完成更新下载'));
    this.publish({ ...this.state, status: 'installing', error: null });
    this.installTask = this.options.prepareInstall().then(() => {
      if (this.disposed) throw new Error('更新已结束');
      // Reply to IPC before the native installer can close the sending window.
      setImmediate(() => { if (!this.disposed) { try { this.options.installer!.install(); } catch { this.installationFailed(); } } });
      return this.current();
    }).catch(() => {
      if (!this.disposed) this.publish({ ...this.state, status: 'downloaded', error: '未能确认笔记保存或当前任务完成，请处理后再重启更新' });
      return this.current();
    }).finally(() => { this.installTask = null; });
    return this.installTask;
  }

  installationFailed() {
    if (this.disposed) return;
    // Native Mac installers may retain a pending install listener after failure;
    // don't issue a second install in this process or allow an accidental retry.
    this.publish({ ...this.state, status: 'available', downloadSupported: false,
      downloadUnavailableReason: '安装失败，请退出并重新打开软件后重试', error: '更新安装失败；请重新打开软件后重试' });
  }

  private publish(state: UpdateState) {
    this.state = state;
    if (!this.disposed) this.options.onChanged(this.current());
  }

  private async performCheck() {
    this.releaseTag = null;
    this.publish({ ...this.state, status: 'checking', latestVersion: null, releaseUrl: null, releaseNotes: null, downloadProgress: null, error: null });
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    timer.unref();
    try {
      const response = await (this.options.fetcher ?? fetch)(latestReleaseEndpoint, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Snipvia-Update-Check' },
        signal: controller.signal, redirect: 'error', credentials: 'omit'
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 404) throw new UpdateCheckError('暂未找到公开的正式发布版本，请稍后重试');
        if (response.status === 403 || response.status === 429) throw new UpdateCheckError('更新服务暂时限制请求，请稍后重试');
        throw new UpdateCheckError('更新服务暂时不可用，请稍后重试');
      }
      const release = await readRelease(response);
      const available = isNewerStableVersion(release.tag_name, this.state.currentVersion);
      const latestVersion = parseVersion(release.tag_name)!.version;
      this.releaseTag = available ? release.tag_name : null;
      this.publish({ ...this.state, status: available ? 'available' : 'up-to-date', latestVersion,
        checkedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
        // Construct the URL from the fixed repository, never trust upstream HTML/link fields.
        releaseUrl: available ? `https://github.com/${releaseRepository}/releases/tag/${encodeURIComponent(release.tag_name)}` : null,
        releaseNotes: available ? release.body?.trim() || null : null,
        error: null });
    } catch (error) {
      this.publish({ ...this.state, status: 'error', latestVersion: null, releaseUrl: null, releaseNotes: null,
        checkedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
        error: controller.signal.aborted ? '检查更新超时，请检查网络后重试'
          : error instanceof UpdateCheckError ? error.message : '无法检查更新，请检查网络后重试' });
    } finally { clearTimeout(timer); this.controller = null; }
    return this.current();
  }
}
