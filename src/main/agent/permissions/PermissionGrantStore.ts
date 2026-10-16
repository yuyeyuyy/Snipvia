import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from '../ToolError';

export interface PermissionGrantStore {
  load(): Promise<string[]>;
  save(keys: readonly string[]): Promise<void>;
}
const schema = z.strictObject({ version: z.literal(1), grants: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1000) });

/** Main-owned app-data file; contains scope hashes only, no paths, source code or command text. */
export class FilePermissionGrantStore implements PermissionGrantStore {
  constructor(readonly filePath: string) {}
  async load(): Promise<string[]> {
    try {
      const stat = await lstat(this.filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error('unsafe store');
      const file = await open(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const actual = await file.stat();
        if (actual.ino !== stat.ino || actual.dev !== stat.dev || actual.size > 128 * 1024) throw new Error('changed store');
        const bytes = Buffer.alloc(128 * 1024 + 1);
        let length = 0;
        while (length < bytes.length) {
          const result = await file.read(bytes, length, bytes.length - length, null);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        if (length > 128 * 1024) throw new Error('oversized store');
        return schema.parse(JSON.parse(bytes.subarray(0, length).toString('utf8'))).grants;
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ToolError('PERMISSION_STORE_ERROR', '无法读取记住的权限，已停止自动授权');
    }
  }
  async save(keys: readonly string[]): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const data = schema.parse({ version: 1, grants: keys });
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const existing = await lstat(this.filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('unsafe store');
      const file = await open(temporary, 'wx', 0o600);
      created = true;
      try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.filePath);
    } catch { throw new ToolError('PERMISSION_STORE_ERROR', '无法保存权限，当前操作未获授权'); }
    finally { if (created) await unlink(temporary).catch(() => {}); }
  }
}
