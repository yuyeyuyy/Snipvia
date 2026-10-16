export type NoteHeading = { text: string; level: number; line: number; from: number; id: string };
export type NoteLink = { from: number; to: number; target: string; label?: string; embed: boolean; wiki: boolean };
const external = /^[a-z][a-z\d+.-]*:/i;

/** Same-length mask: links/headings inside fenced and inline code are not interpreted. */
export function proseMask(content: string): string {
  let fence = ''; let size = 0;
  return content.split('\n').map((line) => {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (match && (!fence || (match[1][0] === fence && match[1].length >= size))) {
      fence = fence ? '' : match[1][0]; size = match[1].length; return ' '.repeat(line.length);
    }
    return fence ? ' '.repeat(line.length) : line.replace(/(`+)[^`\n]*?\1/g, (value) => ' '.repeat(value.length));
  }).join('\n');
}
export function noteHeadings(content: string): NoteHeading[] {
  const lines = content.split('\n'); const masked = proseMask(content).split('\n'); const result: NoteHeading[] = []; let from = 0;
  for (let i = 0; i < lines.length; i++) {
    const atx = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(masked[i]);
    const setext = i + 1 < lines.length ? /^\s{0,3}(=+|-+)\s*$/.exec(masked[i + 1]) : null;
    if (atx || (setext && masked[i].trim() && !/^\s*[-*>]/.test(masked[i]))) {
      const text = (atx ? lines[i].replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '') : lines[i].trim()).replace(/[*_`]/g, '').trim();
      result.push({ text, level: atx ? atx[1].length : setext![1][0] === '=' ? 1 : 2, line: i + 1, from, id: `note-heading-${i + 1}` });
    }
    from += lines[i].length + 1;
  }
  return result;
}
export function noteLinks(content: string): NoteLink[] {
  const mask = proseMask(content); const links: NoteLink[] = [];
  const pattern = /(!?)\[\[([^\]\n]+)\]\]|(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)/g;
  for (const match of mask.matchAll(pattern)) {
    if (match.index > 0 && content[match.index - 1] === '\\') continue;
    if (match[2]) {
      const [target, ...label] = match[2].split('|');
      links.push({ from: match.index, to: match.index + match[0].length, target: target.trim(), label: label.length ? label.join('|') : undefined, embed: !!match[1], wiki: true });
    } else links.push({ from: match.index, to: match.index + match[0].length, target: match[5].replace(/^<|>$/g, ''), label: match[4], embed: !!match[3], wiki: false });
  }
  return links;
}
export function normalizedNotePath(path: string, base = ''): string | null {
  if (external.test(path) || path.startsWith('/') || path.includes('\\') || [...path].some((char) => char.charCodeAt(0) < 32)) return null;
  const parts = base ? base.split('/') : [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}
export function linkParts(target: string) {
  const index = target.indexOf('#');
  const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
  return { path: decode(index < 0 ? target : target.slice(0, index)), anchor: decode(index < 0 ? '' : target.slice(index + 1)) };
}
export function resolveNoteLink(target: string, source: string, paths: string[], wiki = true): { path: string | null; anchor: string; missing: string | null; ambiguous?: string[] } {
  const parts = linkParts(target); const none = { path: null, anchor: parts.anchor, missing: null };
  if (!parts.path) return { ...none, path: source };
  if (external.test(parts.path)) return none;
  const parent = source.split('/').slice(0, -1).join('/');
  const roots = wiki ? [normalizedNotePath(parts.path), normalizedNotePath(parts.path, parent)] : [normalizedNotePath(parts.path, parent), normalizedNotePath(parts.path)];
  const candidates = roots.filter((value): value is string => value !== null && value !== '');
  for (const candidate of candidates) {
    const found = paths.find((path) => path === candidate || path === `${candidate}.md`);
    if (found) return { ...none, path: found };
  }
  if (wiki && !parts.path.includes('/')) {
    const found = paths.filter((path) => path.split('/').at(-1) === parts.path || path.split('/').at(-1) === `${parts.path}.md`);
    if (found.length === 1) return { ...none, path: found[0] };
    if (found.length > 1) return { ...none, ambiguous: found };
  }
  const missing = candidates[0];
  return { ...none, missing: missing && (!/\.[^/]+$/.test(missing) || /\.md$/i.test(missing)) ? missing.replace(/\.md$/i, '') + '.md' : null };
}
export function relativeNotePath(from: string, to: string): string {
  const parent = from.split('/').slice(0, -1); const target = to.split('/');
  while (parent.length && target.length && parent[0] === target[0]) { parent.shift(); target.shift(); }
  return [...parent.map(() => '..'), ...target].map(encodeURIComponent).join('/');
}
/** Rewrite only real resolved references; code blocks and unrelated links remain byte-for-byte. */
export function rewriteNoteLinks(content: string, source: string, newSource: string, paths: string[], moved: (path: string) => string): string {
  let output = content;
  for (const link of noteLinks(content).reverse()) {
    const target = resolveNoteLink(link.target, source, paths, link.wiki);
    if (!target.path) continue;
    const next = moved(target.path);
    if (next === target.path && source === newSource) continue;
    const anchor = link.target.includes('#') ? link.target.slice(link.target.indexOf('#')) : '';
    const address = link.wiki ? next.replace(/\.md$/i, '') : relativeNotePath(newSource, next);
    const replacement = link.wiki ? `${link.embed ? '!' : ''}[[${address}${anchor}${link.label === undefined ? '' : `|${link.label}`}]]`
      : `${link.embed ? '!' : ''}[${link.label ?? ''}](${address}${anchor})`;
    output = output.slice(0, link.from) + replacement + output.slice(link.to);
  }
  return output;
}
/** Convert wiki syntax for the existing Markdown renderer without enabling raw HTML. */
export function renderableNote(content: string): string {
  let result = content;
  for (const link of noteLinks(content).filter((item) => item.wiki).reverse()) {
    const label = (link.label ?? linkParts(link.target).path.split('/').at(-1) ?? link.target) || linkParts(link.target).anchor;
    result = result.slice(0, link.from) + `${link.embed ? '!' : ''}[${label.replace(/[[\]]/g, '')}](snipvia-note:${encodeURIComponent(link.target)})` + result.slice(link.to);
  }
  return result;
}
