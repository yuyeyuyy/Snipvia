import { useEffect, useRef, useState } from 'react';
import { sourceUrl, type WebSource } from '../../../shared/agent/sources';
import { Icon } from '../components/Icon';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import './sources.css';

function host(source: WebSource) { try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function SiteIcon({ source, captureId }: { source: WebSource; captureId?: string }) {
  const [icon, setIcon] = useState<string | null>(null); const element = useRef<HTMLSpanElement>(null);
  const name = host(source);
  useEffect(() => {
    let disposed = false; setIcon(null);
    if (!captureId || !element.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void window.snipvia.agent.sourceIcon(captureId, source.url).then((result) => {
        if (!disposed && result.ok && result.value?.startsWith('data:image/png;base64,')) setIcon(result.value);
      }).catch(() => {});
    });
    observer.observe(element.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [captureId, source.url]);
  return <span ref={element} className="source-site-icon" aria-hidden="true">{icon ? <img src={icon} alt="" /> : name.slice(0, 1).toUpperCase()}</span>;
}

function SourceDialog({ sources, captureId, selected, close, onError }: {
  sources: WebSource[]; captureId?: string; selected?: string; close(): void; onError(message: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current; current?.showModal();
    current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    return () => current?.close();
  }, []);
  async function open(url: string) {
    try { const result = await window.snipvia.browser.openExternal(url); if (!result.ok) onError(result.error); }
    catch { onError('无法打开网页，请重试'); }
  }
  return <dialog ref={dialog} className="source-dialog" aria-label="搜索结果" onCancel={close} onClick={(event) => {
    if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); }
  }}>
    <header><strong>搜索结果</strong><button type="button" aria-label="关闭搜索结果" onClick={close} autoFocus><Icon name="close" size={18} /></button></header>
    <ol className="source-list">{sources.map((source, index) => <li key={source.url} data-selected={selected === source.url}>
      <a href={source.url} rel="noreferrer" onClick={(event) => { event.preventDefault(); void open(source.url); }} title={source.url}>
        <span className="source-meta"><SiteIcon source={source} captureId={captureId} /><span className="source-host">{host(source)}</span>
          {source.publishedAt && <time dateTime={source.publishedAt}>{source.publishedAt.replaceAll('-', '/')}</time>}<span className="source-index">{index + 1}</span></span>
        <strong className="source-title">{source.title}</strong>
        {source.snippet && <span className="source-snippet">{source.snippet}</span>}
        <span className="source-read-state">{source.read ? '已读取网页' : '搜索结果摘要'}</span>
      </a>
    </li>)}</ol>
  </dialog>;
}

/** The list represents real retrieved URLs, not an inferred count of Markdown links. */
export function SourceAnswer({ content, sources = [], captureId, answerClassName, streaming, richCode = false, onError }: {
  richCode?: boolean;
  content?: string; sources?: WebSource[]; captureId?: string; answerClassName?: string; streaming?: boolean; onError(message: string): void;
}) {
  const [opened, setOpened] = useState(false); const [selected, setSelected] = useState<string>();
  const sites = sources.filter((source, index) => sources.findIndex((item) => host(item) === host(source)) === index).slice(0, 4);
  const indices = new Map(sources.map((source, index) => [sourceUrl(source.url), index + 1]));
  const answer = content !== undefined && <MarkdownMessage content={content} richCode={richCode} onError={onError} citations={indices} onCitation={(url) => { setSelected(sourceUrl(url) ?? url); setOpened(true); }} />;
  return <>
    {answerClassName ? <div className={answerClassName} aria-busy={!!streaming}>{answer}</div> : answer}
    {sources.length > 0 && <button type="button" className="source-badge" aria-label={`查看 ${sources.length} 个网页来源`} onClick={() => { setSelected(undefined); setOpened(true); }}>
      <span className="source-icon-stack">{sites.map((source) => <SiteIcon key={source.url} source={source} captureId={captureId} />)}</span><span>{sources.length} 个网页</span>
    </button>}
    {opened && <SourceDialog sources={sources} captureId={captureId} selected={selected} close={() => setOpened(false)} onError={onError} />}
  </>;
}
