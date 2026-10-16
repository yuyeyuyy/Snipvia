import { Parser } from 'htmlparser2';
import { setImmediate } from 'node:timers/promises';
import { ToolError, throwIfAborted } from '../ToolError';
import { utf8Prefix } from './operation';

const hiddenTags = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'canvas', 'head', 'nav', 'footer', 'form']);
const blocks = new Set(['article', 'section', 'main', 'header', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'tr', 'br', 'hr']);
const cleanControls = (text: string) => [...text].filter((char) => char === '\n' || char === '\t' || char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('');
export interface ExtractedWebText { title: string; text: string; truncated: boolean }

/** Parser callbacks only: no DOM, JS, stylesheet evaluation or subresource requests. */
export async function extractWebText(source: string, html: boolean, signal: AbortSignal, maxBytes = 256 * 1024): Promise<ExtractedWebText> {
  throwIfAborted(signal);
  if (!html) {
    const cleaned = cleanControls(source.replace(/\r\n?/g, '\n')).trim();
    return { title: '', text: utf8Prefix(cleaned, maxBytes), truncated: Buffer.byteLength(cleaned) > maxBytes };
  }
  const stack: Array<{ name: string; hidden: boolean; pre: boolean; main: boolean }> = [];
  const parts: string[] = [], mainParts: string[] = [];
  let bytes = 0, mainBytes = 0, title = '', truncated = false, mainTruncated = false;
  const append = (text: string, main = stack.at(-1)?.main) => {
    const clean = cleanControls(text);
    if (main) {
      const part = utf8Prefix(clean, maxBytes - mainBytes);
      if (part) mainParts.push(part); mainBytes += Buffer.byteLength(part);
      if (part.length < clean.length) mainTruncated = true;
    }
    const part = utf8Prefix(clean, maxBytes - bytes);
    if (part) parts.push(part); bytes += Buffer.byteLength(part);
    if (part.length < clean.length) truncated = true;
  };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (stack.length >= 256) throw new ToolError('RESPONSE_TOO_LARGE', '网页嵌套层数超过限制');
      const parent = stack.at(-1);
      const hidden = Boolean(parent?.hidden || hiddenTags.has(name) || 'hidden' in attributes || attributes['aria-hidden'] === 'true' ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style ?? ''));
      if (!hidden && blocks.has(name)) append('\n');
      if (!hidden && name === 'li') append('• ');
      stack.push({ name, hidden, pre: Boolean(parent?.pre || name === 'pre'), main: Boolean(parent?.main || name === 'main' || name === 'article' || attributes.role === 'main') });
    },
    ontext(text) {
      const current = stack.at(-1);
      if (current?.name === 'title') { title = utf8Prefix(`${title}${text}`, 300); return; }
      if (!current?.hidden) append(current?.pre ? text : text.replace(/\s+/g, ' '));
    },
    onclosetag(name) {
      const current = stack.pop();
      if (current && !current.hidden) {
        if (blocks.has(name) && name !== 'br' && name !== 'hr') append('\n', current.main);
        else if (name === 'td' || name === 'th') append('\t');
      }
    }
  }, { decodeEntities: true, xmlMode: false });
  for (let offset = 0; offset < source.length;) {
    throwIfAborted(signal);
    let end = Math.min(source.length, offset + 16 * 1024);
    if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1])) end--;
    parser.write(source.slice(offset, end)); offset = end;
    await setImmediate(undefined, { signal }).catch(() => { throwIfAborted(signal); });
  }
  parser.end();
  throwIfAborted(signal);
  const mainText = mainParts.join('').trim();
  return { title: cleanControls(title).replace(/\s+/g, ' ').trim(),
    text: (mainText || parts.join('')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), truncated: mainText ? mainTruncated : truncated };
}
