import { useEffect, useRef, useState } from 'react';
import type { ChatImage } from '../../../shared/chat-images';
import { Button, IconButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import './image-attachments.css';

function ImagePreview({ image, conversationId, close }: { image: ChatImage; conversationId: string | null; close(): void }) {
  const [url, setUrl] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let active = true; let local = ''; void window.snipvia.chatImages.preview(conversationId, image.id).then(result => {
    if (!active) return; if (!result.ok) { setError(result.error); return; } local = URL.createObjectURL(new Blob([new Uint8Array(result.value.bytes)], { type: result.value.mimeType })); setUrl(local);
  }).catch(() => { if (active) setError('图片无法读取'); }); return () => { active = false; if (local) URL.revokeObjectURL(local); }; }, [conversationId, image.id]);
  return <Dialog label="查看消息图片" className="chat-image-dialog" onClose={close}><header><strong>{image.name}</strong><IconButton icon="close" label="关闭图片预览" onClick={close} /></header>{url ? <img src={url} alt={image.name} /> : <p role={error ? 'alert' : 'status'}>{error || '读取中…'}</p>}<small>{image.width} × {image.height} · 图片保存在本机</small></Dialog>;
}

function ImageAttachment({ image, conversationId, onRemove, disabled }: { image: ChatImage; conversationId: string | null; onRemove?(image: ChatImage): void; disabled?: boolean }) {
  const [url, setUrl] = useState(''); const [error, setError] = useState(false); const [expanded, setExpanded] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true, visible = false, ticket = 0; let local = ''; setUrl(''); setError(false);
    const observer = new IntersectionObserver(entries => {
      const next = entries[0].isIntersecting; if (next === visible) return; visible = next; const request = ++ticket;
      if (!visible) { if (local) URL.revokeObjectURL(local); local = ''; setUrl(''); return; }
      void window.snipvia.chatImages.preview(conversationId, image.id).then(result => {
        if (!active || !visible || request !== ticket) return; if (!result.ok) { setError(true); return; }
        local = URL.createObjectURL(new Blob([new Uint8Array(result.value.bytes)], { type: result.value.mimeType })); setUrl(local); setError(false);
      }).catch(() => { if (active && visible && request === ticket) setError(true); });
    }, { rootMargin: '160px' });
    observer.observe(container.current!);
    return () => { active = false; observer.disconnect(); if (local) URL.revokeObjectURL(local); };
  }, [conversationId, image.id]);
  return <div ref={container} className="chat-image-attachment">
    <Button className="chat-image-thumbnail" title={`${image.name} · ${image.width} × ${image.height}`} aria-label={`查看图片 ${image.name}`} disabled={!url} onClick={() => setExpanded(true)}>
      {url ? <img src={url} alt={image.name} /> : <span>{error ? '图片不可用' : '读取中…'}</span>}
    </Button>
    <span title={image.name}>{image.name}</span>
    {onRemove && <IconButton icon="close" label={`移除图片 ${image.name}`} disabled={disabled} onClick={() => onRemove(image)} />}
    {expanded && <ImagePreview image={image} conversationId={conversationId} close={() => setExpanded(false)} />}
  </div>;
}
export function ImageAttachments({ images, conversationId, onRemove, disabled }: { images: ChatImage[]; conversationId: string | null; onRemove?(image: ChatImage): void; disabled?: boolean }) {
  // Each thumbnail owns and revokes its Blob URL; history never contains Base64 or renderer URLs.
  return <div className="chat-image-attachments" role="group" aria-label={onRemove ? '待发送图片' : '消息图片'}>{images.map(image => <ImageAttachment key={image.id} image={image} conversationId={conversationId} onRemove={onRemove} disabled={disabled} />)}</div>;
}

/** Keep asynchronous imports bound to the originating draft while the user changes conversations. */
export function useImageImport() {
  const active = useRef(new Set<string>()); const [keys, setKeys] = useState(new Set<string>());
  return { busy: keys, async run(key: string, work: () => Promise<void>) { if (active.current.has(key)) return; active.current.add(key); setKeys(new Set(active.current)); try { await work(); } finally { active.current.delete(key); setKeys(new Set(active.current)); } } };
}
