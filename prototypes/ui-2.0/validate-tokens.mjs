import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const tokens = JSON.parse(await readFile(new URL('./tokens.json', import.meta.url), 'utf8'));
assert.deepEqual(Object.keys(tokens.light).sort(), Object.keys(tokens.dark).sort());
function luminance(hex) {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}
const pairs = ['text-primary', 'text-secondary', 'text-muted'].flatMap(text =>
  ['bg-window', 'bg-panel', 'bg-nav', 'bg-input'].map(background => [text, background]));
pairs.push(['text-on-accent', 'accent'], ['text-selected', 'bg-selected']);
for (const text of ['code-text', 'code-comment', 'code-keyword', 'code-string', 'code-number', 'code-function', 'code-variable']) pairs.push([text, 'code-bg']);
for (const status of ['success', 'warning', 'danger']) pairs.push([status, `${status}-bg`]);
const results = ['light', 'dark'].flatMap(theme => pairs.map(([text, background]) => {
  const [low, high] = [luminance(tokens[theme][text]), luminance(tokens[theme][background])].sort((a, b) => a - b);
  const ratio = (high + .05) / (low + .05);
  return { theme, text, background, ratio: Number(ratio.toFixed(2)), passed: ratio >= 4.5 };
}));
await writeFile(new URL('./contrast.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
assert.ok(results.every(result => result.passed), '正文、辅助文字和代码色的对比应达到 4.5:1');
process.stdout.write(`${results.length} 个文字/背景组合通过对比度检查；最低 ${Math.min(...results.map(result => result.ratio))}:1。\n`);
