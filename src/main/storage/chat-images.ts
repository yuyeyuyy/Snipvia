import { app } from 'electron';
import { existsSync, mkdirSync, openSync, closeSync, fstatSync, readFileSync, renameSync, writeFileSync, rmSync, readdirSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { chatImageLimits, chatImageSchema, type ChatImage } from '../../shared/chat-images';

const root = () => join(app.getPath('userData'), 'history', 'attachments');
const path = (id: string) => join(root(), `${z.string().uuid().parse(id)}.png`);
export function writeChatImage(image: ChatImage, bytes: Buffer) {
  chatImageSchema.parse(image); if (bytes.byteLength !== image.bytes) throw new Error('图片内容与元数据不匹配');
  mkdirSync(root(), { recursive: true, mode: 0o700 });
  const temporary = join(root(), `.${randomUUID()}.tmp`);
  try { writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path(image.id)); }
  finally { rmSync(temporary, { force: true }); }
}
export function readChatImage(image: ChatImage): Buffer {
  chatImageSchema.parse(image); let fd: number | undefined;
  try {
    fd = openSync(path(image.id), constants.O_RDONLY | constants.O_NOFOLLOW); const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== image.bytes || stat.size > chatImageLimits.storedBytes) throw new Error('invalid image');
    const bytes = readFileSync(fd); if (bytes.byteLength !== image.bytes) throw new Error('invalid image'); return bytes;
  } catch { throw new Error('历史图片不存在或已损坏，请重新添加'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function removeChatImages(ids: Iterable<string>) { for (const id of ids) { try { rmSync(path(id), { force: true }); } catch { /* Retried by startup orphan cleanup. */ } } }
export function pruneChatImages(referenced: Set<string>) {
  if (!existsSync(root())) return;
  for (const name of readdirSync(root())) if (/^[0-9a-f-]{36}\.png$/.test(name) && !referenced.has(name.slice(0, -4)) || /^\.[0-9a-f-]{36}\.tmp$/.test(name)) { try { rmSync(join(root(), name), { force: true }); } catch { /* A locked file can be cleaned on the next launch. */ } }
}
