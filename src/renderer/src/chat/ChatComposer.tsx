import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ModelProfile, PublicSettings } from '../../../shared/contracts';
import type { ChatImage } from '../../../shared/chat-images';
import type { CapabilityStatus } from '../../../shared/models';
import { modelProfileLabel } from '../../../shared/providers';
import { Icon } from '../components/Icon';
import { Button, Select } from '../components/ui/Button';
import { chatModelId } from './model-choice';
import { ImageAttachments } from './ImageAttachments';

function ImageMenu({ disabled, hasSource, onUpload, onPaste, onScreenshot, onSource }: {
  disabled: boolean; hasSource: boolean; onUpload(): void; onPaste(): void; onScreenshot(): void; onSource(): void;
}) {
  const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('.chat-attachment-menu button')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function choose(action: () => void) { setOpen(false); trigger.current?.focus(); action(); }
  return <div className="chat-attachment-control" ref={root}>
    <button ref={trigger} type="button" className="chat-composer-tool" disabled={disabled} aria-label="添加图片" aria-expanded={open} title="上传、粘贴或选择已有截图" onClick={() => setOpen(value => !value)}><Icon name="image" size={16} /><span>添加图片</span></button>
    {open && <div className="chat-attachment-menu" role="group" aria-label="图片操作" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const position = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (position + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      event.preventDefault(); items[next]?.focus();
    }}><Button variant="quiet" onClick={() => choose(onUpload)}><Icon name="image" size={16} />添加本地图片</Button><Button variant="quiet" onClick={() => choose(onPaste)}><Icon name="copy" size={16} />粘贴图片</Button><Button variant="quiet" onClick={() => choose(onScreenshot)}><Icon name="history" size={16} />添加已有截图</Button>{hasSource && <Button variant="quiet" onClick={() => choose(onSource)}><Icon name="capture" size={16} />使用来源截图</Button>}</div>}
  </div>;
}

/** One controlled composer stays mounted when the welcome page becomes a conversation. */
export function ChatComposer({ inputRef, draft, images, conversationId, settings, modelValue, models, context, contextSelected, pending, loading, imageBusy, modelBusy, modelDisabled, sendDisabled, generating, canStop, vision, hasSource, onDraft, onFiles, onPaste, onUpload, onScreenshot, onSource, onRemove, onModel, onSend, onStop }: {
  inputRef: RefObject<HTMLTextAreaElement | null>; draft: string; images: ChatImage[]; conversationId: string | null; settings: PublicSettings | null;
  models: ModelProfile[]; modelValue: string; context: ReactNode; contextSelected: boolean; pending: boolean; loading: boolean; imageBusy: boolean; modelBusy: boolean; modelDisabled: boolean;
  sendDisabled: boolean; generating: boolean; canStop: boolean; vision: CapabilityStatus; hasSource: boolean;
  onDraft(value: string): void; onFiles(files: File[]): void; onPaste(): void; onUpload(): void; onScreenshot(): void; onSource(): void;
  onRemove(image: ChatImage): void; onModel(profile: ModelProfile): void; onSend(): void; onStop(): void;
}) {
  const disabled = pending || imageBusy || loading || modelBusy;
  useLayoutEffect(() => {
    const node = inputRef.current; if (!node) return;
    const resize = () => { node.style.height = '0px'; const height = Math.min(Math.min(220, Math.max(80, window.innerHeight * .24)), Math.max(58, node.scrollHeight)); node.style.height = `${height}px`; node.style.overflowY = node.scrollHeight > height ? 'auto' : 'hidden'; };
    resize(); let width = node.clientWidth;
    const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; resize(); } });
    observer.observe(node); window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [draft, inputRef]);
  return <form className="workspace-composer" onSubmit={event => { event.preventDefault(); onSend(); }}>
    {contextSelected && <div className="chat-context-chips">{context}</div>}
    {images.length > 0 && <ImageAttachments images={images} conversationId={conversationId} disabled={disabled} onRemove={onRemove} />}
    <textarea ref={inputRef} aria-label="AI 对话输入" maxLength={16000} rows={2} placeholder="有什么问题，尽管问我..." value={draft} disabled={pending || loading} onChange={event => onDraft(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); onSend(); }
    }} onPaste={event => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); onFiles(files); } else if ([...event.clipboardData.types].some(type => type.startsWith('image/'))) { event.preventDefault(); onPaste(); } }} />
    <footer className="chat-composer-footer"><div className="chat-composer-tools">
      <ImageMenu disabled={disabled} hasSource={hasSource} onUpload={onUpload} onPaste={onPaste} onScreenshot={onScreenshot} onSource={onSource} />
      {!contextSelected && context}
      <div className="chat-model-control">{settings ? <Select aria-label="对话模型" title={modelProfileLabel(settings, models)} value={modelValue} disabled={modelDisabled || modelBusy} onChange={event => { const profile = models.find(item => chatModelId(item) === event.target.value); if (profile) onModel(profile); }}>
        {(!models.length || !modelValue) && <option value={modelValue} disabled={models.length > 0}>选择可用模型</option>}
        {models.map(profile => <option key={chatModelId(profile)} value={chatModelId(profile)}>{modelProfileLabel(profile, models)}</option>)}
      </Select> : <span>读取模型…</span>}{settings && <Icon name="chevron" size={13} />}</div>
    </div>{generating ? <Button className="chat-round-send" aria-label="停止生成" title="停止生成" disabled={!canStop} onClick={onStop}><Icon name="stop" size={15} /></Button> : <Button type="submit" className="chat-round-send" variant="primary" aria-label="发送" title="发送（Return）" disabled={sendDisabled}>{pending || modelBusy ? <span className="ui-spinner" /> : <Icon name="arrowUp" size={20} />}</Button>}</footer>
    {(imageBusy || modelBusy || images.length > 0 && vision !== 'supported') && <p className="chat-composer-notice" role={vision === 'unsupported' && images.length ? 'alert' : 'status'}>{imageBusy ? '正在处理图片…' : modelBusy ? '正在恢复对话模型…' : vision === 'unsupported' ? '当前模型已确认不支持图片，请更换模型或移除图片。' : '此模型的图片能力尚未确认，发送后将尝试识别。'}</p>}
  </form>;
}
