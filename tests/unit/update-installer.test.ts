import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const runtime = vi.hoisted(() => ({ packaged: true, metadata: true, signatureValid: true,
  updater: null as unknown, options: null as unknown, download: vi.fn(async () => []), check: vi.fn(), install: vi.fn(), cancel: vi.fn(), signingArguments: [] as string[] }));
vi.mock('electron', () => ({ app: { get isPackaged() { return runtime.packaged; }, getAppPath: () => '/synthetic.app' } }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: (file: string, encoding?: BufferEncoding) =>
    file === '/synthetic.app/package.json' ? JSON.stringify({ snipviaAutoUpdate: runtime.metadata }) : encoding ? actual.readFileSync(file, encoding) : actual.readFileSync(file) };
});
vi.mock('node:child_process', () => ({ execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, output: string) => void) => {
  runtime.signingArguments = args;
  callback(runtime.signatureValid ? null : new Error('PRIVATE_CODESIGN_ERROR'), '');
} }));
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events');
  return { MacUpdater: class extends EventEmitter {
    constructor(options: unknown) { super(); runtime.options = options; runtime.updater = this; }
    checkForUpdates = runtime.check;
    downloadUpdate = runtime.download;
    quitAndInstall = runtime.install;
    setFeedURL(options: unknown) { runtime.options = options; }
  } };
});
import { ElectronUpdateInstaller } from '../../src/main/updates/ElectronUpdateInstaller';
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

beforeEach(() => {
  runtime.packaged = true; runtime.metadata = true; runtime.signatureValid = true;
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/synthetic.app/Contents/Resources' });
  runtime.updater = null; runtime.download.mockReset().mockResolvedValue([]); runtime.install.mockClear(); runtime.cancel.mockClear(); runtime.check.mockReset();
  runtime.check.mockResolvedValue({ isUpdateAvailable: true, cancellationToken: { cancel: runtime.cancel }, updateInfo: { version: '0.3.0', files: [
    { url: `Snipvia-0.3.0-${process.arch}.zip`, size: 123, sha512: 'a'.repeat(86) + '==' }
  ] } });
});
afterEach(() => {
  vi.clearAllMocks();
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  else Reflect.deleteProperty(process, 'resourcesPath');
});

describe.skipIf(process.platform !== 'darwin')('Mac 原生更新适配（全部模拟，不执行系统安装）', () => {
  it('开发、未配置和签名失败均不能下载', async () => {
    const hooks = { beforeInstall: vi.fn(), onInstallError: vi.fn() };
    runtime.packaged = false; expect(new ElectronUpdateInstaller(hooks).supported).toBe(false);
    runtime.packaged = true; runtime.metadata = false; expect(new ElectronUpdateInstaller(hooks).supported).toBe(false);
    runtime.metadata = true; runtime.signatureValid = false;
    await expect(new ElectronUpdateInstaller(hooks).download('0.3.0', 'v0.3.0', vi.fn())).rejects.toThrow();
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it('使用固定发布目录，禁用自动下载安装，只有明确安装请求才执行原生工具', async () => {
    const hooks = { beforeInstall: vi.fn(), onInstallError: vi.fn() }, installer = new ElectronUpdateInstaller(hooks);
    await installer.download('0.3.0', 'v0.3.0', vi.fn());
    expect(runtime.signingArguments).toContain('-R=anchor apple generic and certificate leaf[subject.OU] = "F76JCDMA4Y" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists');
    expect(runtime.options).toEqual({ provider: 'generic', url: 'https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/' });
    expect(runtime.updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, autoRunAppAfterInstall: true, allowDowngrade: false, allowPrerelease: false,
      disableDifferentialDownload: true, disableWebInstaller: true, logger: null });
    expect(runtime.install).not.toHaveBeenCalled(); installer.install();
    expect(hooks.beforeInstall).toHaveBeenCalledOnce(); expect(runtime.install).toHaveBeenCalledWith(false, true);
  });

  it('退出后不使用迟到的元数据开始下载', async () => {
    const installer = new ElectronUpdateInstaller({ beforeInstall: vi.fn(), onInstallError: vi.fn() });
    let done!: (value: unknown) => void;
    runtime.check.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    const pending = installer.download('0.3.0', 'v0.3.0', vi.fn());
    await vi.waitFor(() => expect(runtime.check).toHaveBeenCalled());
    installer.dispose(); done({ isUpdateAvailable: true, updateInfo: { version: '0.3.0', files: [] } });
    await expect(pending).rejects.toThrow('更新已结束'); expect(runtime.download).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example/archive.zip', '../archive.zip', 'Snipvia-0.3.0-other.zip'])('拒绝更新清单中的任意地址 %s', async url => {
    runtime.check.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '0.3.0', files: [{ url, size: 123, sha512: 'a'.repeat(86) + '==' }] } });
    await expect(new ElectronUpdateInstaller({ beforeInstall: vi.fn(), onInstallError: vi.fn() }).download('0.3.0', 'v0.3.0', vi.fn())).rejects.toThrow('校验信息');
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it('元数据版本不一致或缺少哈希不下载，校验失败不允许安装', async () => {
    const installer = new ElectronUpdateInstaller({ beforeInstall: vi.fn(), onInstallError: vi.fn() });
    await expect(installer.download('0.4.0', 'v0.4.0', vi.fn())).rejects.toThrow('不一致');
    runtime.download.mockRejectedValueOnce(new Error('checksum mismatch'));
    await expect(installer.download('0.3.0', 'v0.3.0', vi.fn())).rejects.toThrow('checksum');
    expect(() => installer.install()).toThrow('没有可安装');
    runtime.check.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: '0.3.0', files: [{ url: `Snipvia-0.3.0-${process.arch}.zip`, size: 123, sha512: '' }] } });
    await expect(installer.download('0.3.0', 'v0.3.0', vi.fn())).rejects.toThrow('校验信息');
  });
});

const require = createRequire(import.meta.url);
const { macUpdateMetadata } = require('../../scripts/macos-release/update-metadata.cjs') as { macUpdateMetadata(directory: string): string };
it('最终更新元数据只接受完整冻结清单，并拒绝改动或替换的发布文件', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-update-manifest-'));
  const artifacts = ['arm64', 'x64'].flatMap(arch => ['zip', 'dmg'].map(ext => {
    const name = `Snipvia-0.3.0-${arch}.${ext}`, content = Buffer.from('synthetic frozen release ' + arch + ext);
    writeFileSync(join(directory, name), content);
    return { name, sha256: createHash('sha256').update(content).digest('hex') };
  }));
  writeFileSync(join(directory, 'verification.json'), JSON.stringify({ version: '0.3.0', teamId: 'F76JCDMA4Y', artifacts }));
  try {
    const metadata = JSON.parse(macUpdateMetadata(directory));
    expect(metadata.files).toHaveLength(4); expect(metadata.version).toBe('0.3.0');
    expect(metadata.files[0].sha512).toBe(createHash('sha512').update(readFileSync(join(directory, artifacts[0].name))).digest('base64'));
    writeFileSync(join(directory, artifacts[0].name), 'altered'); expect(() => macUpdateMetadata(directory)).toThrow('校验失败');
    rmSync(join(directory, artifacts[0].name)); symlinkSync(join(directory, artifacts[1].name), join(directory, artifacts[0].name));
    expect(() => macUpdateMetadata(directory)).toThrow('普通文件');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
