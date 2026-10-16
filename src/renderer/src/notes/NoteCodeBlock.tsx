import { Fragment, useEffect, useState } from 'react';
import { codeLanguageLabel, codeTokens, type CodeToken } from './code-language';

export function NoteCodeBlock({ code, info }: { code: string; info: string }) {
  const [tokens, setTokens] = useState<CodeToken[]>([]);
  const [copied, setCopied] = useState(false); const [copying, setCopying] = useState(false); const [error, setError] = useState('');
  const language = codeLanguageLabel(info);
  useEffect(() => {
    let cancelled = false; setTokens([]);
    void codeTokens(code, info).then(value => { if (!cancelled) setTokens(value); }).catch(() => { /* Unavailable or unknown languages remain plain text. */ });
    return () => { cancelled = true; };
  }, [code, info]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    if (copying) return; setCopying(true); setError('');
    try { const result = await window.snipvia.notes.copyCode(code); if (!result.ok) throw new Error(result.error); setCopied(true); }
    catch { setError('复制失败，请重试'); }
    finally { setCopying(false); }
  }
  let offset = 0;
  const colored = tokens.map((token, index) => {
    const plain = code.slice(offset, token.from); offset = token.to;
    return <Fragment key={index}>{plain}<span className={token.className}>{code.slice(token.from, token.to)}</span></Fragment>;
  });
  return <div className="note-code-block">
    <div className="note-code-heading"><button type="button" className="note-code-language" aria-label={`复制 ${language} 代码`} title="点击语言名称复制代码" disabled={copying} onClick={() => void copy()}>{copied ? '已复制' : language}</button></div>
    <pre tabIndex={0}><code>{tokens.length ? <>{colored}{code.slice(offset)}</> : code}</code></pre>
    {error && <small className="note-code-copy-error" role="alert">{error}</small>}
  </div>;
}
