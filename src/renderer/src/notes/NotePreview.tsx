import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderableNote, resolveNoteLink } from '../../../shared/note-markdown';
import { NoteCodeBlock } from './NoteCodeBlock';

type Props = { content: string; notebookId: string; path: string; paths: string[]; onLink(target: string, wiki: boolean): void; depth?: number };
function Attachment({ target, wiki, label, context }: { target: string; wiki: boolean; label: string; context: Props }) {
  const [value, setValue] = useState<{ image?: string; content?: string; error?: string }>({});
  const resolved = resolveNoteLink(target, context.path, context.paths, wiki).path;
  useEffect(() => {
    let cancelled = false; setValue({});
    if (!resolved) return;
    if (/\.md$/i.test(resolved) && (context.depth ?? 0) < 1 && resolved !== context.path) {
      void window.snipvia.notes.read(context.notebookId, resolved).then((result) => { if (!cancelled) setValue(result.ok ? { content: result.value.content.slice(0, 20_000) } : { error: result.error }); });
    } else {
      void window.snipvia.notes.image(context.notebookId, resolved).then((result) => { if (!cancelled) setValue(result.ok && result.value ? { image: result.value } : { error: '附件' }); });
    }
    return () => { cancelled = true; };
  }, [context.notebookId, context.path, resolved, context.depth]);
  if (value.image) return <img src={value.image} alt={label} className="note-attachment-image" />;
  if (value.content !== undefined && resolved) return <div className="note-embed"><NotePreview {...context} content={value.content} path={resolved} depth={(context.depth ?? 0) + 1} /></div>;
  return <button className="note-attachment-link" onClick={() => context.onLink(target, wiki)}>{label || target}{!resolved ? ' · 未找到' : value.error ? '' : ' · 加载中'}</button>;
}

export function NotePreview(props: Props) {
  const headingId = (line: number | undefined) => props.depth ? undefined : `note-heading-${line}`;
  return <div className="note-preview markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => {
    if (/^(?:https?:|snipvia-note:)/i.test(url) || !/^[a-z][a-z\d+.-]*:/i.test(url)) return url;
    return '';
  }} components={{
    pre: ({ children }) => {
      const code = Children.toArray(children).find(child => isValidElement(child));
      if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) return <pre>{children}</pre>;
      return <NoteCodeBlock code={String(code.props.children ?? '')} info={/language-([^\s]+)/.exec(code.props.className ?? '')?.[1] ?? ''} />;
    },
    table: ({ children }) => <div className="note-table-scroll" tabIndex={0}><table>{children}</table></div>,
    p: ({ children }) => <div className="note-paragraph">{children}</div>,
    a: ({ href, children }) => <a href={href || '#'} onClick={(event) => { event.preventDefault(); if (href) props.onLink(href.startsWith('snipvia-note:') ? decodeURIComponent(href.slice(13)) : href, href.startsWith('snipvia-note:')); }}>{children}</a>,
    img: ({ src, alt }) => typeof src === 'string' && !/^https?:/i.test(src) ? <Attachment target={src.startsWith('snipvia-note:') ? decodeURIComponent(src.slice(13)) : src} wiki={src.startsWith('snipvia-note:')} label={alt ?? ''} context={props} /> : <span className="note-remote-image">[外部图片：{alt || '未加载'}]</span>,
    h1: ({ node, children }) => <h1 id={headingId(node?.position?.start.line)}>{children}</h1>,
    h2: ({ node, children }) => <h2 id={headingId(node?.position?.start.line)}>{children}</h2>,
    h3: ({ node, children }) => <h3 id={headingId(node?.position?.start.line)}>{children}</h3>,
    h4: ({ node, children }) => <h4 id={headingId(node?.position?.start.line)}>{children}</h4>,
    h5: ({ node, children }) => <h5 id={headingId(node?.position?.start.line)}>{children}</h5>,
    h6: ({ node, children }) => <h6 id={headingId(node?.position?.start.line)}>{children}</h6>
  }}>{renderableNote(props.content)}</ReactMarkdown></div>;
}
