import { z } from 'zod';
import { defineWebTool } from '../../ToolRegistry';
import type { WebContentStore } from '../../web/WebContentStore';
import { throwIfAborted } from '../../ToolError';

export function createReadWebChunkTool(contents: WebContentStore) {
  return defineWebTool({
    name: 'read_web_chunk',
    description: '读取同一会话 fetch_url 缓存的后续文本，不重新联网。传入 metadata.contentId 和 nextOffset；下一块仍受输出大小上限约束。缓存过期时重新 fetch_url。',
    schema: z.strictObject({ contentId: z.string().uuid(), offset: z.number().int().min(0).max(256 * 1024) }),
    async execute(input, context) {
      throwIfAborted(context.signal);
      return { success: true, output: contents.read(context.scope, input.contentId, input.offset) };
    }
  });
}
