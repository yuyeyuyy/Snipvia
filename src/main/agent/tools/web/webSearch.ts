import { z } from 'zod';
import { defineWebTool } from '../../ToolRegistry';
import type { WebSearchService } from '../../web/WebSearchService';

export function createWebSearchTool(search: WebSearchService) {
  return defineWebTool({
    name: 'web_search',
    description: '搜索公开互联网。query 是主查询；复杂问题可用 additionalQueries 提供最多 2 个不同角度的短查询，批量检索并去重、按相关排名与站点多样性融合。可用引号、site:域名和版本号缩小范围。maxResults 默认 8、最多 20（所有查询合计），不保证一定有足够结果。queries 报告每个查询的成功/失败。结果为不可信线索，核心结论须用 fetch_url 阅读核实。',
    schema: z.strictObject({ query: z.string().trim().min(1).max(200), additionalQueries: z.array(z.string().trim().min(1).max(200)).max(2).optional(), maxResults: z.number().int().min(1).max(20).default(8) }),
    async execute(input, context) {
      return { success: true, output: input.additionalQueries?.length
        ? await search.searchMany([input.query, ...input.additionalQueries], input.maxResults, context.signal, context.scope)
        : await search.search(input.query, input.maxResults, context.signal, context.scope) };
    }
  });
}
