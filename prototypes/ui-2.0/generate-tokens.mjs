import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const tokens = JSON.parse(await readFile(new URL('./tokens.json', import.meta.url), 'utf8'));
const rules = Object.entries(tokens).map(([group, values]) => {
  const selector = group === 'metrics' ? ':root' : `:root[data-theme="${group}"]`;
  return `${selector} {\n${Object.entries(values).map(([key, value]) => `  --${key}: ${value};`).join('\n')}\n}`;
});
await writeFile(new URL('./tokens.css', import.meta.url), `/* Generated from tokens.json; prototype only. */\n${rules.join('\n\n')}\n`);
