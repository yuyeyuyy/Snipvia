import { ToolError } from '../ToolError';

export function newlineStyle(text: string): 'LF' | 'CRLF' {
  const crlf = text.includes('\r\n');
  if (text.replace(/\r\n/g, '').includes('\r') || (crlf && text.replace(/\r\n/g, '').includes('\n'))) {
    throw new ToolError('MIXED_NEWLINES', '文件使用混合换行，无法保证原有格式，请先统一换行');
  }
  return crlf ? 'CRLF' : 'LF';
}

export function normalizeNewlines(text: string, style: 'LF' | 'CRLF'): string {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new ToolError('INVALID_INPUT', '修改内容包含不支持的 CR 换行');
  return style === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

export function validateText(text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > 256 * 1024) throw new ToolError('FILE_TOO_LARGE', '文件预览与写入最多支持 256 KiB');
  if (text !== new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) ||
      bytes.some((value) => value < 9 || (value > 13 && value < 32))) {
    throw new ToolError('UNSUPPORTED_ENCODING', '只支持有效的 UTF-8 文本');
  }
}

export function applySearchReplace(before: string, edits: Array<{ search: string; replace: string }>): string {
  const style = newlineStyle(before);
  let after = before;
  for (const edit of edits) {
    const search = normalizeNewlines(edit.search, style);
    const replace = normalizeNewlines(edit.replace, style);
    if (!search) throw new ToolError('INVALID_INPUT', 'SEARCH 不能为空');
    const index = after.indexOf(search);
    if (index < 0) throw new ToolError('NO_MATCH', 'SEARCH 内容不存在，请重新读取文件');
    if (after.indexOf(search, index + 1) >= 0) throw new ToolError('AMBIGUOUS_MATCH', 'SEARCH 匹配多处，请提供更多上下文');
    after = after.slice(0, index) + replace + after.slice(index + search.length);
    validateText(after);
  }
  return after;
}

/** A bounded, linear-time unified diff. One hunk spans the changed region; no quadratic LCS. */
export function createFileDiff(filePath: string, before: string | null, after: string | null): string {
  const lines = (value: string | null): string[] => value ? value.match(/[^\n]*\n|[^\n]+$/g)! : [];
  const old = lines(before);
  const next = lines(after);
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const leading = Math.min(3, prefix);
  const trailing = Math.min(3, suffix);
  const start = prefix - leading;
  const oldEnd = old.length - suffix;
  const nextEnd = next.length - suffix;
  const oldCount = oldEnd - start + trailing;
  const newCount = nextEnd - start + trailing;
  const output = [`--- ${before === null ? '/dev/null' : `a/${filePath}`}`, `+++ ${after === null ? '/dev/null' : `b/${filePath}`}`,
    `@@ -${oldCount ? start + 1 : start},${oldCount} +${newCount ? start + 1 : start},${newCount} @@`];
  const append = (prefix: string, text: string) => {
    output.push(prefix + text.replace(/\r?\n$/, ''));
    if (!text.endsWith('\n')) output.push('\\ No newline at end of file');
  };
  for (let index = start; index < prefix; index++) append(' ', old[index]);
  for (let index = prefix; index < oldEnd; index++) append('-', old[index]);
  for (let index = prefix; index < nextEnd; index++) append('+', next[index]);
  for (let index = 0; index < trailing; index++) append(' ', old[oldEnd + index]);
  return output.join('\n');
}
