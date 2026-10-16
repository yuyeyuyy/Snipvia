import { app } from 'electron';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AppUpdater } from 'electron-updater';
import type { UpdateInstaller } from './UpdateInstaller';
import { releaseRepository } from './UpdateCheckService';

const runFile = promisify(execFile);
const macSigningTeam = 'F76JCDMA4Y';

/** A narrow adapter over the pinned v26 updater; it never executes installer scripts. */
export class ElectronUpdateInstaller implements UpdateInstaller {
  readonly supported: boolean;
  readonly unavailableReason: string | null;
  private updater: AppUpdater | null = null;
  private prepared = false;
  private disposed = false;
  private cancelDownload: (() => void) | null = null;
  private feedTag: string | null = null;

  constructor(private readonly hooks: { beforeInstall(): void; onInstallError(): void }) {
    let enabled = false;
    try {
      const metadata = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'));
      enabled = metadata.snipviaAutoUpdate === true;
    } catch { /* Unconfigured and development builds cannot replace themselves. */ }
    this.supported = app.isPackaged && process.platform === 'darwin' && enabled;
    this.unavailableReason = this.supported ? null : !app.isPackaged ? '开发版仅检查版本，请使用正式安装版下载更新'
      : process.platform === 'win32' ? '当前 Windows 发行包未配置签名更新，请从发布页下载安装'
        : process.platform !== 'darwin' ? '当前平台请从发布页手动更新' : '此安装包未启用签名更新，请从发布页安装新版';
  }

  async download(version: string, tag: string, progress: (percent: number) => void) {
    if (!this.supported || this.disposed) throw new Error(this.unavailableReason ?? '更新已结束');
    // Refuse ad-hoc, tampered or differently signed current applications before
    // allowing native Squirrel to compare the replacement's code signature.
    const bundle = dirname(dirname(process.resourcesPath));
    await runFile('/usr/bin/codesign', ['--verify', '--deep', '--strict',
      `-R=anchor apple generic and certificate leaf[subject.OU] = "${macSigningTeam}" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`, bundle],
    { timeout: 8_000, maxBuffer: 64 * 1024 });
    if (this.disposed) throw new Error('更新已结束');
    if (!this.updater) {
      const { MacUpdater } = await import('electron-updater');
      if (this.disposed) throw new Error('更新已结束');
      // Pin metadata to the exact Release the user chose, rather than whichever
      // version becomes latest while the download is in progress.
      this.updater = new MacUpdater({ provider: 'generic', url: `https://github.com/${releaseRepository}/releases/download/${encodeURIComponent(tag)}/` });
      this.feedTag = tag;
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
      this.updater.autoRunAppAfterInstall = true;
      this.updater.allowPrerelease = false;
      this.updater.allowDowngrade = false;
      this.updater.disableDifferentialDownload = true;
      this.updater.disableWebInstaller = true;
      this.updater.logger = null;
      this.updater.on('error', () => {
        if (this.prepared && !this.disposed) this.hooks.onInstallError();
      });
    }
    const updater = this.updater;
    if (this.feedTag !== tag) {
      // Explicit override only for our release-pinned generic provider.
      updater.setFeedURL({ provider: 'generic', url: `https://github.com/${releaseRepository}/releases/download/${encodeURIComponent(tag)}/` });
      this.feedTag = tag;
    }
    const result = await updater.checkForUpdates();
    if (this.disposed) throw new Error('更新已结束');
    if (!result?.isUpdateAvailable || result.updateInfo.version.split('+')[0] !== version) throw new Error('发布版本与更新元数据不一致');
    const files = result.updateInfo.files;
    const prefix = `Snipvia-${result.updateInfo.version}-`;
    if (!files.length || files.some(file => !['arm64.zip', 'x64.zip', 'arm64.dmg', 'x64.dmg'].some(suffix => file.url === prefix + suffix)
      || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) || !Number.isSafeInteger(file.size) || file.size! <= 0)
      || !files.some(file => file.url === `${prefix}${process.arch}.zip`)) throw new Error('更新文件或校验信息无效');
    const listener = (value: { percent: number }) => progress(value.percent);
    this.cancelDownload = () => result.cancellationToken?.cancel();
    updater.on('download-progress', listener);
    try {
      await updater.downloadUpdate(result.cancellationToken); // Full download, SHA-512 verification and cache validation are owned by the updater.
      if (this.disposed) throw new Error('更新已结束');
      this.prepared = true;
    } finally { this.cancelDownload = null; updater.removeListener('download-progress', listener); }
  }

  install() {
    if (!this.prepared || !this.updater || this.disposed) throw new Error('没有可安装的更新');
    this.hooks.beforeInstall();
    // Squirrel verifies the signed ZIP before replacing the app and restarting.
    this.updater.quitAndInstall(false, true);
  }

  dispose() {
    this.disposed = true;
    this.cancelDownload?.();
    // Do not install on an ordinary quit. Pending downloads are handled by the
    // updater process lifecycle; no application files are touched here.
  }
}
