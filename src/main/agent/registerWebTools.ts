import type { ToolRegistry } from './ToolRegistry';
import { PublicHttpClient } from './web/PublicHttpClient';
import { WebPageService } from './web/WebPageService';
import { WebSearchService } from './web/WebSearchService';
import type { WebSearchProvider } from './web/WebSearchProvider';
import { createFetchUrlTool } from './tools/web/fetchUrl';
import { createWebSearchTool } from './tools/web/webSearch';
import { createReadWebChunkTool } from './tools/web/readWebChunk';

export function registerWebTools(registry: ToolRegistry, options: { searchProvider?: WebSearchProvider; http?: PublicHttpClient } = {}) {
  const pages = new WebPageService(options.http);
  const search = new WebSearchService(options.searchProvider);
  registry.register(createWebSearchTool(search));
  registry.register(createFetchUrlTool(pages));
  registry.register(createReadWebChunkTool(pages.contents));
  return { pages, search };
}
