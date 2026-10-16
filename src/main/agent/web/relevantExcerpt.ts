/** Select a real contiguous passage, retaining offsets for subsequent chunk reads. */
export function relevantOffset(text: string, focus: string): number {
  const normalized = focus.toLocaleLowerCase();
  const terms = [...new Set(normalized.match(/[a-z0-9_+.-]{2,}|[\p{Script=Han}]{2,}/gu) ?? [])];
  const keywords = terms.flatMap((term) => /\p{Script=Han}/u.test(term) && term.length > 2
    ? [term, ...Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2))] : [term]).slice(0, 64);
  if (!keywords.length) return 0;
  let best = 0, bestScore = 0;
  // Window at paragraph boundaries, with fixed windows for long unbroken text.
  const starts = new Set([0]);
  for (const match of text.matchAll(/\n\s*\n/g)) starts.add(match.index + match[0].length);
  for (let offset = 800; offset < text.length; offset += 800) starts.add(offset);
  for (const raw of starts) {
    const offset = raw > 0 && /[\uDC00-\uDFFF]/.test(text[raw] ?? '') ? raw + 1 : raw;
    const passage = text.slice(offset, offset + 1000).toLocaleLowerCase();
    const score = keywords.reduce((sum, word) => sum + (passage.includes(word) ? Math.min(word.length, 12) : 0), 0);
    if (score > bestScore) { best = offset; bestScore = score; }
  }
  return best;
}
