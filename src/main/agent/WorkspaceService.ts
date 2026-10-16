import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, open, opendir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ToolError, throwIfAborted } from './ToolError';
import { isInsideWorkspace, workspaceRelativePath } from './policies/pathPolicy';

declare const workspaceGrantBrand: unique symbol;
/** Process-local capability; an ID or an IPC-cloned object is not a grant. */
export interface WorkspaceGrant {
  readonly id: string;
  readonly [workspaceGrantBrand]: true;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
}

export interface WorkspaceText {
  path: string;
  content: string;
  byteLength: number;
  encoding: 'utf-8';
}

export interface WorkspaceAccess {
  readText(relativePath: string, maxBytes: number): Promise<WorkspaceText>;
  listDirectory(relativePath: string, maxEntries: number): Promise<{
    path: string;
    entries: WorkspaceEntry[];
    truncated: boolean;
  }>;
}

export interface FileSnapshot {
  readonly path: string;
  readonly content: string | null;
  readonly bom: boolean;
  readonly hash: string | null;
  readonly version: string;
}

type SnapshotRecord = { grant: WorkspaceGrant; absolutePath: string; parent: BigIntStats; stat: BigIntStats | null; bytes: Buffer | null };

export function fileHash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

function fileVersion(stat: BigIntStats | null, hash: string | null): string {
  return stat ? `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.size}:${stat.mode}:${hash}` : 'missing';
}

type WorkspaceRecord = { root: string; identity: BigIntStats; controller: AbortController };
const maximumFileBytes = 1024 * 1024;
const maximumDirectoryEntries = 5000;

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function boundedInteger(value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new ToolError('INVALID_INPUT', '读取上限无效');
  }
}

async function canonicalLocation(location: string): Promise<string> {
  try { return await realpath(location); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(location) === location) throw error;
    return path.join(await canonicalLocation(path.dirname(location)), path.basename(location));
  }
}

export class WorkspaceService {
  private readonly grants = new WeakMap<WorkspaceGrant, WorkspaceRecord>();
  private readonly snapshots = new WeakMap<FileSnapshot, SnapshotRecord>();
  private readonly committing = new Set<string>();
  constructor(private readonly protectedDirectories: readonly string[] = []) {}

  /** Trusted Main only: call AFTER explicit folder authorization. Never use cwd as a fallback. */
  async authorizeWorkspace(absolutePath: string): Promise<WorkspaceGrant> {
    if (!path.isAbsolute(absolutePath)) throw new ToolError('INVALID_INPUT', '授权目录必须使用绝对路径');
    const root = await realpath(absolutePath);
    const identity = await lstat(root, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new ToolError('NOT_A_DIRECTORY', '授权目标不是目录');
    const grant = Object.freeze({ id: randomUUID() }) as WorkspaceGrant;
    this.grants.set(grant, { root, identity, controller: new AbortController() });
    return grant;
  }

  revoke(grant: WorkspaceGrant): void {
    this.grants.get(grant)?.controller.abort(new ToolError('PERMISSION_DENIED', 'workspace 授权已撤销'));
  }

  revocationSignal(grant: WorkspaceGrant | undefined): AbortSignal {
    return this.record(grant).controller.signal;
  }

  /** Human-readable scope for the approval UI, not a filesystem capability. */
  displayPath(grant: WorkspaceGrant): string { return this.record(grant).root; }

  /** Main-only process cwd resolution. A model never receives or creates a grant. */
  async processDirectory(grant: WorkspaceGrant, relativePath: string, signal: AbortSignal): Promise<string> {
    const record = this.record(grant);
    const target = await this.inspect(record, relativePath, () => { throwIfAborted(signal); throwIfAborted(record.controller.signal); });
    if (!target.stat.isDirectory()) throw new ToolError('NOT_A_DIRECTORY', '命令工作目录不是文件夹');
    return target.absolutePath;
  }

  /** Stable across restarts, but not across directory replacement. Does not grant filesystem access. */
  permissionIdentity(grant: WorkspaceGrant): string {
    const record = this.record(grant);
    return fileHash(Buffer.from(`${record.root}\0${record.identity.dev}\0${record.identity.ino}`));
  }

  createAccess(grant: WorkspaceGrant, signal: AbortSignal): WorkspaceAccess {
    const record = this.record(grant);
    const check = () => {
      throwIfAborted(signal);
      throwIfAborted(record.controller.signal);
    };
    return Object.freeze({
      readText: async (relativePath: string, maxBytes: number) => {
        const { path, content, byteLength, encoding } = await this.readData(record, relativePath, maxBytes, check);
        return { path, content, byteLength, encoding };
      },
      listDirectory: (relativePath: string, maxEntries: number) => this.listDirectory(record, relativePath, maxEntries, check)
    });
  }

  private record(grant: WorkspaceGrant | undefined): WorkspaceRecord {
    const record = grant && this.grants.get(grant);
    if (!record) throw new ToolError('WORKSPACE_REQUIRED', '请先明确授权一个 workspace');
    throwIfAborted(record.controller.signal);
    return record;
  }

  private async inspect(record: WorkspaceRecord, input: string, check: () => void) {
    check();
    const relativePath = workspaceRelativePath(input);
    const candidate = path.resolve(record.root, relativePath);
    const protectedLocations = await Promise.all(this.protectedDirectories.map((directory) => canonicalLocation(path.resolve(directory))));
    if (protectedLocations.some((directory) => isInsideWorkspace(directory, candidate))) {
      throw new ToolError('PERMISSION_DENIED', 'Agent 不得访问自己的权限或 MCP 配置目录');
    }
    const rootStat = await lstat(record.root, { bigint: true });
    check();
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !sameFile(rootStat, record.identity) ||
        await realpath(record.root) !== record.root) {
      throw new ToolError('WORKSPACE_CHANGED', '授权目录已被移动或替换，请重新授权');
    }
    let absolutePath = record.root;
    let stat = rootStat;
    const segments = relativePath === '.' ? [] : relativePath.split('/');
    for (const segment of segments) {
      check();
      if (!stat.isDirectory()) throw new ToolError('NOT_A_DIRECTORY', '路径中的父级不是目录');
      absolutePath = path.join(absolutePath, segment);
      stat = await lstat(absolutePath, { bigint: true });
      if (stat.isSymbolicLink()) throw new ToolError('SYMLINK_NOT_ALLOWED', '不允许通过符号链接访问文件');
      const canonical = await realpath(absolutePath);
      if (!isInsideWorkspace(record.root, canonical)) {
        throw new ToolError('PATH_OUTSIDE_WORKSPACE', '路径不在授权 workspace 内');
      }
    }
    check();
    return { relativePath, absolutePath, stat };
  }

  private async readData(record: WorkspaceRecord, input: string, maxBytes: number, check: () => void) {
    boundedInteger(maxBytes, maximumFileBytes);
    const target = await this.inspect(record, input, check);
    if (!target.stat.isFile()) throw new ToolError('NOT_A_FILE', '目标不是普通文本文件');
    if (target.stat.size > BigInt(maxBytes)) throw new ToolError('FILE_TOO_LARGE', '文件超过读取上限');
    // NOFOLLOW protects the final component; NONBLOCK avoids hanging on a substituted FIFO.
    const handle = await open(target.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      check();
      const openedStat = await handle.stat({ bigint: true });
      if (!openedStat.isFile() || !sameFile(openedStat, target.stat)) throw new ToolError('PATH_CHANGED', '读取前文件发生变化');
      const checked = await this.inspect(record, input, check);
      if (!sameFile(checked.stat, openedStat)) throw new ToolError('PATH_CHANGED', '读取前路径发生变化');
      if (openedStat.size > BigInt(maxBytes)) throw new ToolError('FILE_TOO_LARGE', '文件超过读取上限');
      const chunks: Buffer[] = [];
      let byteLength = 0;
      while (byteLength <= maxBytes) {
        check();
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - byteLength));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, byteLength);
        check();
        if (bytesRead === 0) break;
        byteLength += bytesRead;
        if (byteLength > maxBytes) throw new ToolError('FILE_TOO_LARGE', '文件超过读取上限');
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const after = await this.inspect(record, input, check);
      const finalStat = await handle.stat({ bigint: true });
      check();
      if (!sameFile(after.stat, openedStat) || finalStat.mtimeNs !== openedStat.mtimeNs || finalStat.size !== openedStat.size) {
        throw new ToolError('PATH_CHANGED', '读取期间文件发生变化，请重试');
      }
      const bytes = Buffer.concat(chunks, byteLength);
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new ToolError('UNSUPPORTED_ENCODING', '只支持 UTF-8 文本文件', { bytesRead: byteLength });
      }
      if (bytes.some((value) => value < 9 || (value > 13 && value < 32))) {
        throw new ToolError('UNSUPPORTED_ENCODING', '不支持二进制文件', { bytesRead: byteLength });
      }
      check();
      return { path: target.relativePath, content, byteLength, encoding: 'utf-8' as const, bytes, stat: finalStat };
    } finally {
      await handle.close();
    }
  }

  /** Main-only mutation support. Never included in ToolContext or the preload bridge. */
  async snapshot(grant: WorkspaceGrant, input: string, signal: AbortSignal): Promise<FileSnapshot> {
    const record = this.record(grant);
    const check = () => { throwIfAborted(signal); throwIfAborted(record.controller.signal); };
    const relative = workspaceRelativePath(input);
    if (relative === '.') throw new ToolError('NOT_A_FILE', '不能替换 workspace 根目录');
    const parent = await this.inspect(record, path.posix.dirname(relative), check);
    if (!parent.stat.isDirectory()) throw new ToolError('NOT_A_DIRECTORY', '父目录不存在或不是目录');
    let data: Awaited<ReturnType<WorkspaceService['readData']>> | null = null;
    try { data = await this.readData(record, relative, 256 * 1024, check); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      const stillParent = await this.inspect(record, path.posix.dirname(relative), check);
      if (!sameFile(stillParent.stat, parent.stat)) throw new ToolError('FILE_CONFLICT', '父目录已发生变化');
    }
    if (data && data.stat.nlink !== 1n) throw new ToolError('PERMISSION_DENIED', '不修改存在硬链接的文件');
    const hash = data ? fileHash(data.bytes) : null;
    const snapshot = Object.freeze({ path: relative, content: data?.content ?? null,
      bom: data ? data.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) : false,
      hash, version: fileVersion(data?.stat ?? null, hash) });
    this.snapshots.set(snapshot, { grant, parent: parent.stat, stat: data?.stat ?? null,
      absolutePath: path.join(parent.absolutePath, path.posix.basename(relative)), bytes: data?.bytes ?? null });
    return snapshot;
  }

  /** Main-only: confirmed file changes or the selected notebook's narrow automatic write capability. */
  async commitSnapshot(snapshot: FileSnapshot, after: string | null, bom: boolean, signal: AbortSignal): Promise<FileSnapshot> {
    const saved = this.snapshots.get(snapshot);
    if (!saved) throw new ToolError('PERMISSION_DENIED', '修改提案无效');
    const record = this.record(saved.grant);
    const check = () => { throwIfAborted(signal); throwIfAborted(record.controller.signal); };
    const key = saved.absolutePath;
    if (this.committing.has(key)) throw new ToolError('FILE_BUSY', '此文件正在提交另一项修改');
    this.committing.add(key);
    let temporary: string | undefined;
    let temporaryIdentity: BigIntStats | undefined;
    let committed = false;
    try {
      check();
      const bytes = after === null ? null : Buffer.from(`${bom ? '\ufeff' : ''}${after}`, 'utf8');
      if (bytes && bytes.length > 256 * 1024) throw new ToolError('FILE_TOO_LARGE', '修改后的文件超过 256 KiB 上限');
      let nextStat: BigIntStats | null = null;
      if (bytes) {
        const parent = await this.inspect(record, path.posix.dirname(snapshot.path), check);
        if (!sameFile(parent.stat, saved.parent)) throw new ToolError('FILE_CONFLICT', '父目录已发生变化');
        temporary = path.join(parent.absolutePath, `.snipvia-change-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
          temporaryIdentity = await handle.stat({ bigint: true });
          check();
          await handle.writeFile(bytes, { signal });
          if (saved.stat) await handle.chmod(Number(saved.stat.mode & 0o777n));
          await handle.sync();
          nextStat = await handle.stat({ bigint: true });
        } finally { await handle.close(); }
      }
      // Re-read bytes, identity and parent after staging and immediately before the commit syscall.
      const current = await this.snapshot(saved.grant, snapshot.path, signal);
      const currentSaved = this.snapshots.get(current)!;
      if (current.version !== snapshot.version || !sameFile(currentSaved.parent, saved.parent)) {
        throw new ToolError('FILE_CONFLICT', '文件在预览后已被修改，请重新生成 diff 并确认');
      }
      check();
      // Once dispatched, await the syscall's actual outcome; cancellation must not report "no write".
      if (bytes === null) await unlink(saved.absolutePath);
      else if (saved.stat === null) await link(temporary!, saved.absolutePath); // Atomic no-clobber create.
      else await rename(temporary!, saved.absolutePath); // Same-directory atomic replacement.
      committed = true;
      const hash = bytes ? fileHash(bytes) : null;
      const next = Object.freeze({ path: snapshot.path, content: after, bom, hash, version: fileVersion(nextStat, hash) });
      this.snapshots.set(next, { ...saved, stat: nextStat, bytes });
      return next;
    } catch (error) {
      if (error instanceof ToolError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (signal.aborted && !committed) throwIfAborted(signal);
      if (code === 'EEXIST') throw new ToolError('FILE_CONFLICT', '目标文件已被其他程序创建');
      if (code === 'ENOSPC' || code === 'EDQUOT') throw new ToolError('WRITE_FAILED', '磁盘空间或配额不足，文件未提交');
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new ToolError('WRITE_FAILED', '文件或目录不可写，文件未提交');
      throw new ToolError('WRITE_FAILED', '文件写入或原子提交失败');
    } finally {
      if (temporary) {
        // A successful rename consumes the temp path; link-based creation still needs cleanup.
        try {
          const remaining = await lstat(temporary, { bigint: true });
          if (temporaryIdentity && sameFile(remaining, temporaryIdentity) && !remaining.isSymbolicLink()) await unlink(temporary);
        } catch { /* Do not misreport an already committed write. */ }
      }
      this.committing.delete(key);
    }
  }

  private async listDirectory(record: WorkspaceRecord, input: string, maxEntries: number, check: () => void) {
    boundedInteger(maxEntries, maximumDirectoryEntries);
    const target = await this.inspect(record, input, check);
    if (!target.stat.isDirectory()) throw new ToolError('NOT_A_DIRECTORY', '目标不是目录');
    const directory = await opendir(target.absolutePath);
    const entries: WorkspaceEntry[] = [];
    let truncated = false;
    // The async iterator closes the handle on completion, error and early break.
    for await (const entry of directory) {
      check();
      if (entries.length === maxEntries) { truncated = true; break; }
      entries.push({
        name: entry.name,
        path: target.relativePath === '.' ? entry.name : `${target.relativePath}/${entry.name}`,
        type: entry.isSymbolicLink() ? 'symlink' : entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other'
      });
    }
    const after = await this.inspect(record, input, check);
    if (!sameFile(after.stat, target.stat)) throw new ToolError('PATH_CHANGED', '读取期间目录发生变化');
    check();
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    return { path: target.relativePath, entries, truncated };
  }
}
