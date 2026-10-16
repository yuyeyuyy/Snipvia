import { describe, expect, it } from 'vitest';
import { codeLanguage, codeLanguageLabel, codeTokens } from '../../src/renderer/src/notes/code-language';

describe('笔记代码的官方语言解析', () => {
  it.each([['py', 'Python'], ['python', 'Python'], ['js', 'JavaScript'], ['ts', 'TypeScript'], ['c++', 'C++']])('解析语言别名 %s', (info, label) => {
    expect(codeLanguageLabel(info)).toBe(label); expect(codeLanguage(info)).not.toBeNull();
  });
  it('Python 注释、关键字和数值分开着色，保留全部源码', async () => {
    const code = 'def search(nums):\n    # 检查循环边界\n    left = 0\n    return "<script>"\n';
    const tokens = await codeTokens(code, 'python');
    expect(tokens.filter(token => token.className.includes('tok-comment')).map(token => code.slice(token.from, token.to))).toEqual(['# 检查循环边界']);
    expect(tokens.filter(token => token.className.includes('tok-keyword')).map(token => code.slice(token.from, token.to))).toEqual(expect.arrayContaining(['def', 'return']));
    expect(tokens.filter(token => token.className.includes('tok-number')).map(token => code.slice(token.from, token.to))).toContain('0');
    let from = 0, restored = '';
    for (const token of tokens) { expect(token.from).toBeGreaterThanOrEqual(from); restored += code.slice(from, token.from) + code.slice(token.from, token.to); from = token.to; }
    expect(restored + code.slice(from)).toBe(code);
  });
  it('未知语言与超大代码退回纯文本，不自动执行或猜测', async () => {
    expect(await codeTokens('unsafe()', 'unknown-language')).toEqual([]);
    expect(await codeTokens('x'.repeat(256 * 1024 + 1), 'python')).toEqual([]);
    expect(await codeTokens('print(1)', 'text')).toEqual([]);
  });
});
