import { BraveWebSearchProvider } from './BraveWebSearchProvider';
import { DuckDuckGoWebSearchProvider } from './DuckDuckGoWebSearchProvider';
import { ExaWebSearchProvider } from './ExaWebSearchProvider';
import type { WebSearchProvider } from './WebSearchProvider';

/** Main-owned configuration. Keys never reach Renderer, tool arguments or URLs. */
export function defaultSearchProvider(env: NodeJS.ProcessEnv = process.env): WebSearchProvider {
  if (env.SNIPVIA_BRAVE_SEARCH_API_KEY) return new BraveWebSearchProvider(() => env.SNIPVIA_BRAVE_SEARCH_API_KEY);
  if (env.SNIPVIA_WEB_SEARCH_PROVIDER === 'duckduckgo') return new DuckDuckGoWebSearchProvider();
  return new ExaWebSearchProvider(undefined, () => env.SNIPVIA_EXA_SEARCH_API_KEY);
}
