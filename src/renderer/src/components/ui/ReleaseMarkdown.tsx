import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function ReleaseMarkdown({ content, onError }: { content: string; onError(message: string): void }) {
  function safe(value: string) {
    try { const url = new URL(value); return value.length <= 2048 && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : ''; }
    catch { return ''; }
  }
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safe} components={{
    a: ({ href, children }) => href && safe(href) ? <a href={href} rel="noreferrer" onClick={event => { event.preventDefault(); void window.snipvia.browser.openExternal(href).then(result => { if (!result.ok) onError(result.error); }); }}>{children}</a> : <span className="blocked-link">{children}</span>,
    img: ({ alt }) => <span>[图片链接已省略{alt ? '：' + alt : ''}]</span>
  }}>{content}</ReactMarkdown></div>;
}
