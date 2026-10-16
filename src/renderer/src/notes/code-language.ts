import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightTree } from '@lezer/highlight';

export const noteCodeLanguages = (info: string) => codeLanguage(info);
export type CodeToken = { from: number; to: number; className: string };
export function codeLanguage(info: string) {
  const name = info.trim().split(/\s+/)[0].replace(/^\{\.?|\}$/g, '');
  return !name || /^(?:text|txt|plaintext|plain|none)$/i.test(name) ? null
    : LanguageDescription.matchLanguageName(languages, name, false) ?? LanguageDescription.matchFilename(languages, `snippet.${name}`);
}
export function codeLanguageLabel(info: string): string {
  return codeLanguage(info)?.name ?? (info.trim().split(/\s+/)[0].slice(0, 40) || 'Text');
}
/** The same Lezer grammars and classes color editable and reading-mode code. */
export async function codeTokens(code: string, info: string): Promise<CodeToken[]> {
  const language = codeLanguage(info);
  if (!language || code.length > 256 * 1024) return [];
  const support = language.support ?? await language.load();
  const tokens: CodeToken[] = [];
  highlightTree(support.language.parser.parse(code), classHighlighter, (from, to, className) => { tokens.push({ from, to, className }); });
  return tokens;
}
