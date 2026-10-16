// Explicit, small public-web evaluation; never part of the regular tests or screenshot flow.
/* global AbortSignal, console */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
const runtime = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
try {
  const { WebSearchService } = await runtime.ssrLoadModule('/src/main/agent/web/WebSearchService.ts');
  const { DuckDuckGoWebSearchProvider } = await runtime.ssrLoadModule('/src/main/agent/web/DuckDuckGoWebSearchProvider.ts');
  const { ExaWebSearchProvider } = await runtime.ssrLoadModule('/src/main/agent/web/ExaWebSearchProvider.ts');
  const { WebPageService } = await runtime.ssrLoadModule('/src/main/agent/web/WebPageService.ts');
  const provider = process.argv.includes('--duckduckgo') ? new DuckDuckGoWebSearchProvider() : new ExaWebSearchProvider();
  const search = new WebSearchService(provider);
  const queries = ['Steam "OS error 0" macOS', 'site:help.steampowered.com macOS game launch', 'site:github.com/ValveSoftware macOS "OS error 0"'];
  const report = { at: new Date().toISOString(), provider: provider.id, queries };
  const measure = async (work) => {
    const start = performance.now();
    try { const output = await work(); return { durationMs: Math.round(performance.now() - start), ...output }; }
    catch (error) { return { durationMs: Math.round(performance.now() - start), error: error.code ?? 'UNKNOWN', message: error.message }; }
  };
  report.singleQueryFive = await measure(() => search.search(queries[0], 5, AbortSignal.timeout(11000)));
  report.multiQueryTwenty = await measure(() => search.searchMany(queries, 20, AbortSignal.timeout(9500)));
  const first = report.multiQueryTwenty.results?.[0];
  if (first) report.focusedRead = await measure(async () => {
    const page = await new WebPageService().fetch(first.url, {}, AbortSignal.timeout(11000), 'macOS Steam OS error 0 game launch');
    return { url: page.url, title: page.title, returnedBytes: Buffer.byteLength(page.text), metadata: page.metadata };
  });
  console.log(JSON.stringify(report, null, 2));
} finally { await runtime.close(); }
