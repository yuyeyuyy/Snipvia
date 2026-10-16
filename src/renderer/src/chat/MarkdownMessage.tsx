import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NoteCodeBlock } from '../notes/NoteCodeBlock';
import { sourceUrl } from '../../../shared/agent/sources';

function safeExternalUrl(value: string | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function MarkdownMessage({ content, onError, citations, onCitation, richCode = false }: { richCode?: boolean; content: string; onError(message: string): void; citations?: Map<string | null, number>; onCitation?(url: string): void }) {
  return <div className="markdown-body">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={(url) => safeExternalUrl(url) ?? ''}
      components={{
        a: ({ href, children, ...properties }) => {
          const safeUrl = safeExternalUrl(href);
          if (!safeUrl) return <span className="blocked-link" title="已阻止不安全或无效的链接">{children}</span>;
          const citation = citations?.get(sourceUrl(safeUrl));
          if (citation && onCitation) return <button type="button" className="source-citation" aria-label={`查看来源 ${citation}`} title={safeUrl} onClick={() => onCitation(safeUrl)}>{citation}</button>;
          return <a {...properties} href={safeUrl} rel="noreferrer" onClick={async (event) => {
            event.preventDefault();
            const result = await window.snipvia.browser.openExternal(safeUrl);
            if (!result.ok) onError(result.error);
          }}>{children}</a>;
        },
        ...(richCode ? { pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>, code: ({ className, children, node }: { className?: string; children?: React.ReactNode; node?: { position?: { start: { line: number }; end: { line: number } } } }) => className || node?.position && node.position.end.line > node.position.start.line ? <NoteCodeBlock code={String(children).replace(/\n$/, '')} info={className?.replace('language-', '') ?? ''} /> : <code>{children}</code> } : {}),
        img: ({ alt }) => <span className="markdown-image-placeholder">[图片链接已省略{alt ? `：${alt}` : ''}]</span>
      }}
    >{content}</ReactMarkdown>
  </div>;
}
