import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import { normalizeToolError, ToolError, throwIfAborted } from '../../ToolError';
import { defineTool } from '../../ToolRegistry';
import { workspaceRelativePath } from '../../policies/pathPolicy';
import type { ToolContext } from '../../types/tool';

const searchSchema = z.strictObject({
  path: z.string().min(1).max(4096).default('.'),
  name: z.string().min(1).max(256).optional(),
  glob: z.string().min(1).max(256).optional(),
  keyword: z.string().min(1).max(256).optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(200).default(100),
  maxDepth: z.number().int().min(0).max(20).default(8)
});

export interface SearchFilesOutput {
  matches: Array<{ path: string; line?: number; preview?: string }>;
  scannedEntries: number;
  readBytes: number;
  truncated: boolean;
  limitsReached: Array<'results' | 'entries' | 'depth' | 'bytes'>;
  skipped: { symlinks: number; excludedDirectories: number; binary: number; tooLarge: number; unreadable: number };
}

const excludedDirectories = new Set(['.git', 'node_modules']);
const maxEntries = 5000;
const maxFileBytes = 1024 * 1024;
const maxTotalBytes = 16 * 1024 * 1024;

function validateGlob(glob: string): void {
  // Keep the grammar small and bounded: *, ?, and whole-segment **. No regex/extglob/brace expansion.
  if (path.posix.isAbsolute(glob) || path.win32.isAbsolute(glob) || /[\\\0:{}()[\]]/.test(glob) ||
      glob.split('/').some((part) => part === '..' || (part.includes('**') && part !== '**'))) {
    throw new ToolError('INVALID_INPUT', 'glob 仅支持相对路径、*、? 和独立路径段 **');
  }
}

async function search(input: z.infer<typeof searchSchema>, context: ToolContext): Promise<SearchFilesOutput> {
  if (!input.name && !input.glob && !input.keyword) throw new ToolError('INVALID_INPUT', '至少提供 name、glob 或 keyword');
  if (input.glob) validateGlob(input.glob);
  const root = workspaceRelativePath(input.path);
  const output: SearchFilesOutput = {
    matches: [], scannedEntries: 0, readBytes: 0, truncated: false, limitsReached: [],
    skipped: { symlinks: 0, excludedDirectories: 0, binary: 0, tooLarge: 0, unreadable: 0 }
  };
  const limit = (reason: SearchFilesOutput['limitsReached'][number]) => {
    output.truncated = true;
    if (!output.limitsReached.includes(reason)) output.limitsReached.push(reason);
  };
  const normalize = (value: string) => input.caseSensitive ? value : value.toLowerCase();
  const needle = input.keyword ? normalize(input.keyword) : undefined;
  const pending = [{ path: root, depth: 0 }];
  while (pending.length) {
    // Yield even for cached directories so cancel/timeout events can run during a large search.
    await setImmediate();
    throwIfAborted(context.signal);
    const current = pending.pop()!;
    const remaining = maxEntries - output.scannedEntries;
    if (remaining === 0) { limit('entries'); break; }
    let directory;
    try {
      directory = await context.workspace.listDirectory(current.path, remaining);
    } catch (error) {
      const normalized = normalizeToolError(error);
      if (current.depth > 0 && ['NOT_FOUND', 'NOT_A_DIRECTORY', 'SYMLINK_NOT_ALLOWED', 'PATH_CHANGED'].includes(normalized.code)) {
        output.skipped.unreadable++;
        continue;
      }
      throw error;
    }
    if (directory.truncated) limit('entries');
    for (const entry of directory.entries) {
      throwIfAborted(context.signal);
      output.scannedEntries++;
      if (entry.type === 'symlink') { output.skipped.symlinks++; continue; }
      if (entry.type === 'directory') {
        if (excludedDirectories.has(entry.name)) output.skipped.excludedDirectories++;
        else if (current.depth >= input.maxDepth) limit('depth');
        else pending.push({ path: entry.path, depth: current.depth + 1 });
        continue;
      }
      if (entry.type !== 'file') continue;
      if (input.name && !normalize(entry.name).includes(normalize(input.name))) continue;
      const relative = root === '.' ? entry.path : entry.path.slice(root.length + 1);
      if (input.glob && !path.posix.matchesGlob(input.glob.includes('/') ? relative : entry.name, input.glob)) continue;
      const match: SearchFilesOutput['matches'][number] = { path: entry.path };
      if (needle !== undefined) {
        if (output.readBytes >= maxTotalBytes) { limit('bytes'); return output; }
        try {
          const text = await context.workspace.readText(entry.path, Math.min(maxFileBytes, maxTotalBytes - output.readBytes));
          output.readBytes += text.byteLength;
          const index = normalize(text.content).indexOf(needle);
          if (index < 0) continue;
          match.line = text.content.slice(0, index).split('\n').length;
          // A single bounded excerpt per file; never return the whole file through search.
          const lineStart = text.content.lastIndexOf('\n', index - 1) + 1;
          const previewStart = Math.max(lineStart, index - 80);
          match.preview = text.content.slice(previewStart, previewStart + 240).split(/\r?\n/, 1)[0];
        } catch (error) {
          throwIfAborted(context.signal);
          const normalized = normalizeToolError(error);
          output.readBytes += normalized.details?.bytesRead ?? 0;
          if (normalized.code === 'UNSUPPORTED_ENCODING') output.skipped.binary++;
          else if (normalized.code === 'FILE_TOO_LARGE') {
            output.skipped.tooLarge++;
            if (maxTotalBytes - output.readBytes < maxFileBytes) { limit('bytes'); return output; }
          }
          else if (['NOT_FOUND', 'NOT_A_FILE', 'SYMLINK_NOT_ALLOWED', 'PATH_CHANGED'].includes(normalized.code)) output.skipped.unreadable++;
          else throw error;
          continue;
        }
      }
      output.matches.push(match);
      if (output.matches.length >= input.maxResults) { limit('results'); return output; }
    }
    if (directory.truncated) break;
  }
  throwIfAborted(context.signal);
  return output;
}

export const searchFilesTool = defineTool({
  name: 'search_files',
  description: '在 workspace 中递归搜索文件。name 为文件名子串，glob 支持 *、?、**，keyword 为文本子串；多个条件取交集。文本/名称默认忽略大小写，glob 区分大小写。不跟随链接，跳过 .git 和 node_modules。每个文件最多返回一条匹配及行号；truncated 表示未完成全量搜索。',
  permission: 'workspace:read',
  schema: searchSchema,
  async execute(input, context) {
    return { success: true, output: await search(input, context) };
  }
});
