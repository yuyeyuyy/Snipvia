import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ConversationSummary, ModelProfile, PublicSettings, WorkspaceConversation } from '../../../shared/contracts';
import type { AgentExecutionSnapshot } from '../../../shared/agent/execution';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Button, IconButton, Select } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { LoadingState } from '../components/ui/LoadingState';
import { SourceAnswer } from '../agent/SourceReferences';
import { AgentActivityLine, AgentTimeline } from '../agent/AgentExecution';
import { agentActivity } from '../agent/activity';
import './workspace.css';
import { EditingPanel } from './EditingPanel';
import { useImageImport } from './ImageAttachments';
import { Icon } from '../components/Icon';
import { ChatComposer } from './ChatComposer';
import { ChatMessages, UserMessage } from './ChatMessages';
import { useChatScroll } from './useChatScroll';
import { useConversationModel } from './useConversationModel';
import { chatImageLimits, type ChatImage } from '../../../shared/chat-images';
import type { CapabilityStatus } from '../../../shared/models';

type Entry = { conversation?: WorkspaceConversation; draft: string; images?: ChatImage[]; error?: string; scroll?: number; follow?: boolean };

/** A view over the existing history and Agent services; no second transcript or key store. */
export function ChatWorkspace({ conversationId, items, settings, switchingModel, onSelect, onRefresh, onSwitchModel, onSettings, onNew, newRequest, onStatus }: {
  conversationId: string | null; items: ConversationSummary[]; settings: PublicSettings | null; switchingModel: boolean;
  onNew(): void; newRequest: number; onStatus(value: { blocked: boolean; activeId: string | null }): void;
  onSelect(id: string | null): void; onRefresh(): Promise<void>; onSwitchModel(profile: ModelProfile): Promise<void>; onSettings(): void;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({ new: { draft: '' } });
  const [snapshots, setSnapshots] = useState<Record<string, AgentExecutionSnapshot>>({});
  const [editingBusy, setEditingBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const importing = useImageImport(); const [vision, setVision] = useState<CapabilityStatus>('unknown');
  const [dragging, setDragging] = useState(false); const [sourcePicker, setSourcePicker] = useState(false); const [sources, setSources] = useState<Array<{ id: string; title: string; createdAt: string }>>([]);
  const restored = useRef(new Set<string>());
  const [pending, setPending] = useState(false); const [loading, setLoading] = useState(false); const [copied, setCopied] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const current = useRef(conversationId); current.current = conversationId;
  const key = conversationId ?? 'new'; const entry = entries[key] ?? { draft: '' };
  const snapshot = conversationId ? snapshots[conversationId] : undefined;
  const modelReady = settings && (settings.hasApiKey || settings.provider === 'custom');
  const run = snapshot?.runs.at(-1); const imageBusy = importing.busy.has(key); const busy = pending || editingBusy || !!snapshot?.busy;
  const callbacks = useRef({ onRefresh, onStatus }); callbacks.current = { onRefresh, onStatus };
  const messages = entry.conversation?.messages ?? [];
  const activeConversation = activeId && items.some(item => item.id === activeId) ? activeId : null;
  const model = useConversationModel({ id: conversationId, saved: entry.conversation?.profile, hasMessages: !!messages.length, settings, history: items, activeId: activeConversation, onSwitch: onSwitchModel });
  const blocked = pending || editingBusy || imageBusy || switchingModel || model.restoring;
  useEffect(() => { callbacks.current.onStatus({ blocked, activeId: activeConversation }); }, [blocked, activeConversation]);
  const scrolling = useChatScroll({ id: conversationId, loading, position: entry.scroll, follow: entry.follow, count: messages.length, sequence: run?.sequence, onPosition: (scroll, follow) => update(key, { scroll, follow }) });
  const previousNew = useRef(newRequest);
  useEffect(() => { if (previousNew.current === newRequest) return; previousNew.current = newRequest; for (const image of entries.new?.images ?? []) void window.snipvia.chatImages.remove(null, image.id); update('new', { draft: '', images: [], error: '' }); model.resetNew(); }, [newRequest]);
  const revision = useRef(new Map<string, number>());
  function update(id: string, patch: Partial<Entry>) {
    setEntries(values => {
      const next = { ...values, [id]: { ...(values[id] ?? { draft: '' }), ...patch } };
      // Retain drafts/scroll for every thread; bound the expensive image/transcript view cache.
      const cached = Object.keys(next).filter(key => next[key].conversation);
      for (const old of cached) if (cached.length > 5 && old !== id && old !== current.current) {
        next[old] = { ...next[old], conversation: undefined }; cached.splice(cached.indexOf(old), 1);
      }
      return next;
    });
  }
  function accept(value: AgentExecutionSnapshot) {
    const id = value.conversationId;
    if (!id || value.revision < (revision.current.get(id) ?? -1)) return;
    revision.current.set(id, value.revision);
    setActiveId(value.activeConversationId ?? (value.busy ? id : null));
    setSnapshots(values => ({ ...values, [id]: value }));
  }
  function error(message: string) { update(current.current ?? 'new', { error: message }); }
  async function read(id: string) {
    const result = await window.snipvia.history.read(id);
    if (result.ok) update(id, { conversation: result.value });
    else update(id, { error: result.error });
  }
  useEffect(() => {
    const changed = window.snipvia.agent.onChanged(value => {
      const id = value.conversationId;
      if (!id) return;
      accept(value);
      const last = value.runs.at(-1);
      if (last?.finished) {
        if (!value.busy && !last.saved && last.images?.length && !restored.current.has(last.runId)) { restored.current.add(last.runId); update(id, { images: last.images, draft: last.question }); }
        void read(id); void callbacks.current.onRefresh();
      }
    });
    const saved = window.snipvia.history.onChanged(() => { if (current.current) { void read(current.current); void window.snipvia.agent.workspaceState(current.current).then(result => { if (result.ok) accept(result.value); }); } });
    return () => { changed(); saved(); };
  }, []);
  useEffect(() => { let active = true; setVision('unknown'); void window.snipvia.chatImages.capability().then(result => { if (active && result.ok) setVision(result.value); }).catch(() => {}); return () => { active = false; }; }, [settings]);
  useEffect(() => {
    let active = true; setCopied(null); setSourcePicker(false); setDragging(false);
    if (!conversationId) { setLoading(false); return; }
    setLoading(true);
    void Promise.all([read(conversationId), window.snipvia.agent.workspaceState(conversationId)]).then(([, result]) => {
      if (!active) return;
      if (result.ok) accept(result.value);
      else update(conversationId, { error: result.error });
    }).catch(() => { if (active) update(conversationId, { error: '无法读取对话，请重新打开或重试。' }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId]);
  useEffect(() => {
    const retained = new Set(['new', ...items.map(item => item.id), ...(conversationId ? [conversationId] : [])]);
    setEntries(values => Object.fromEntries(Object.entries(values).filter(([id]) => retained.has(id))));
    setSnapshots(values => Object.fromEntries(Object.entries(values).filter(([id]) => retained.has(id))));
  }, [items, conversationId]);
  useLayoutEffect(() => { if (!loading) input.current?.focus(); }, [conversationId, loading]);
  useEffect(() => { if (copied === null) return; const timer = setTimeout(() => setCopied(null), 1600); return () => clearTimeout(timer); }, [copied]);
  async function create(): Promise<string> {
    const result = await window.snipvia.history.create();
    if (!result.ok) throw new Error(result.error);
    if (entry.images?.length) { const bound = await window.snipvia.chatImages.bind(result.value.id, entry.images.map(image => image.id)); if (!bound.ok) throw new Error(bound.error); }
    update(result.value.id, { conversation: result.value, draft: entry.draft, images: entry.images }); update('new', { images: [], draft: '' }); onSelect(result.value.id);
    await onRefresh(); return result.value.id;
  }
  async function send(regenerate = false) {
    if (busy || imageBusy || loading || switchingModel || model.blocked || model.restoring || activeConversation && activeConversation !== conversationId) return;
    const text = regenerate ? entry.conversation?.messages.at(-2)?.content : entry.draft.trim() || (entry.images?.length ? '请分析这些图片。' : '');
    if (!text) return;
    if (!regenerate && entry.images?.length && vision === 'unsupported') { error('当前模型不支持图片，请更换视觉模型或移除图片。'); return; }
    if (!modelReady) { error('请先在设置中配置模型和 API Key。'); return; }
    setPending(true); let id = conversationId;
    try {
      id ??= await create(); update(id, { error: '', follow: true });
      const result = await window.snipvia.agent.workspaceStart(id, text, regenerate, regenerate ? [] : entry.images?.map(image => image.id) ?? []);
      if (!result.ok) throw new Error(result.error);
      accept(result.value);
      if (!regenerate) update(id, { draft: '', images: [] });
    } catch (cause) { update(id ?? 'new', { error: cause instanceof Error ? cause.message : '发送失败，请重试。' }); }
    finally { setPending(false); }
  }
  async function stop() {
    if (!conversationId || !run || run.finished) return;
    try { const result = await window.snipvia.agent.workspaceStop(conversationId, run.runId); if (!result.ok) error(result.error); }
    catch { error('停止失败，请重试。'); }
  }
  async function copy(content: string, index: number) {
    try { const result = await window.snipvia.notes.copyCode(content); if (!result.ok) throw new Error(result.error); setCopied(index); }
    catch { error('复制失败，请重试。'); }
  }
  async function addImages(work: (scope: string | null) => Promise<import('../../../shared/contracts').Result<ChatImage[]>>) {
    const target = key, scope = conversationId;
    await importing.run(target, async () => { try { const result = await work(scope); if (!result.ok) throw new Error(result.error); setEntries(values => ({ ...values, [target]: { ...(values[target] ?? { draft: '' }), images: [...(values[target]?.images ?? []), ...result.value], error: '' } })); } catch (cause) { update(target, { error: cause instanceof Error ? cause.message : '添加图片失败' }); } });
  }
  async function importFiles(files: File[]) {
    await addImages(async scope => {
      if (!files.length || files.length > chatImageLimits.perTurn || files.some(file => file.size > chatImageLimits.sourceBytes)) throw new Error('仅支持 PNG / JPEG，每条消息最多 4 张，每张小于 10 MiB');
      const payload = await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
      return window.snipvia.chatImages.import(scope, payload);
    });
  }
  async function removeImage(image: ChatImage) { const scope = conversationId, target = key; try { const result = await window.snipvia.chatImages.remove(scope, image.id); if (!result.ok) throw new Error(result.error); setEntries(values => ({ ...values, [target]: { ...(values[target] ?? { draft: '' }), images: values[target]?.images?.filter(value => value.id !== image.id) } })); } catch (cause) { update(target, { error: cause instanceof Error ? cause.message : '移除图片失败' }); } }
  async function pickSource() { try { const result = await window.snipvia.chatImages.sources(); if (!result.ok) throw new Error(result.error); setSources(result.value); setSourcePicker(true); } catch { error('无法读取已有截图'); } }
  // Keep saved replies visible until the refreshed transcript includes the committed turn.
  const showRun = run && (!run.saved || messages.length < run.messageIndex + 2 || busy);
  const legacyController = run?.captureId && snapshot ? {
    captureId: run.captureId, snapshot: { ...snapshot, captureId: run.captureId }, enabled: true, busy, starting: pending, selecting: false,
    setEnabled: () => {}, start: async () => false, stop, selectNotebook: async () => false,
    decide: async (runId: string, requestId: string, decision: 'allow_once' | 'allow_session' | 'deny') => {
      const result = await window.snipvia.agent.decide(run.captureId!, runId, requestId, decision); if (!result.ok) throw new Error(result.error);
    }
  } : null;
  const activity = showRun ? agentActivity(run) : null;
  return <section className={`ai-workspace workspace-panel${dragging ? ' image-drop-active' : ''}`} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); event.dataTransfer.dropEffect = 'copy'; } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); const files = [...event.dataTransfer.files]; if (files.length) void importFiles(files); else error('请拖入本地 PNG / JPEG 图片，远程图片地址不会自动下载。'); }}>
    <WorkspaceHeader title="AI 对话">
      <Select aria-label="选择对话" value={conversationId ?? ''} disabled={blocked} onChange={event => onSelect(event.target.value || null)}><option value="">新对话</option>{items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>
      <Button disabled={blocked} onClick={onNew}><Icon name="edit" size={15} />新建对话</Button>
    </WorkspaceHeader>
    <EditingPanel conversationId={conversationId} messages={messages} settings={settings} busy={pending || imageBusy || !!snapshot?.busy || model.restoring} ensureConversation={create} onError={error} onBlockingChange={setEditingBusy}>{editing => <div className={`chat-workspace-body${!messages.length && !showRun && !loading && !entry.conversation?.capture ? ' chat-welcome-mode' : ''}`}>
      <div className="ai-workspace-scroll" ref={scrolling.scroll} onScroll={scrolling.onScroll}>
        <div className="ai-workspace-transcript" ref={scrolling.content}>
          {loading ? <LoadingState>正在打开对话…</LoadingState> : <>
            {entry.conversation?.capture && <details className="workspace-source-image"><summary>查看来源截图</summary><img src={entry.conversation.capture.dataUrl} alt="对话来源截图" /></details>}
            <ChatMessages messages={messages} conversationId={conversationId} copied={copied} disabled={busy || loading || switchingModel || model.blocked || !!activeConversation} onCopy={(content, index) => void copy(content, index)} onRegenerate={() => void send(true)} onError={error} renderProposals={editing.proposals}>
              {showRun && <section className="workspace-live-answer" aria-label="当前回答" aria-busy={!run.finished}>
                {run.messageIndex >= messages.length && <UserMessage message={{ role: 'user', content: run.question, images: run.images }} conversationId={conversationId} />}
                <article className="workspace-message assistant"><header><Icon name="brand" size={16} /><strong>截然</strong></header>{legacyController && <AgentTimeline run={run} controller={legacyController} />}{activity && <AgentActivityLine {...activity} state={run.state} />}
                  <SourceAnswer content={run.answer} sources={run.sources} richCode streaming={run.answerStreaming} answerClassName="agent-answer" onError={error} />
                  {run.notice && <p role={run.state === 'tool_error' ? 'alert' : 'status'}>{run.notice}</p>}
                  {editing.pendingProposals}
                  {run.finished && run.answer && <Button variant="quiet" onClick={() => void copy(run.answer!, -1)}><Icon name="copy" size={14} />{copied === -1 ? '已复制' : '复制回答'}</Button>}
                </article>
              </section>}
            </ChatMessages>
            {!showRun && editing.pendingProposals}
          </>}
        </div>
      </div>
      <div className="ai-workspace-input">
        <div className="chat-welcome"><Icon name="brand" size={32} /><h2>开始一段 AI 对话</h2><p>选择已配置的模型，直接提问或继续已有对话。</p></div>
        {scrolling.showJump && <IconButton className="chat-jump-bottom" icon="arrowUp" label="回到最新消息" onClick={scrolling.jump} />}
        {entry.error && <p className="workspace-chat-error" role="alert"><Icon name="info" size={16} /><span>{entry.error}</span><Button variant="quiet" onClick={() => update(key, { error: '' })}>关闭</Button></p>}
        {model.issue && <p className="workspace-chat-error" role="alert"><Icon name="info" size={16} /><span>{model.issue}</span></p>}
        {activeConversation && activeConversation !== conversationId && <p className="chat-background-task" role="status">另一段对话正在生成<Button variant="quiet" onClick={() => onSelect(activeConversation)}>查看对话</Button></p>}
        {editing.error}
        {!modelReady && <p className="workspace-config-hint">尚未配置模型。<Button variant="quiet" onClick={onSettings}>打开模型设置</Button></p>}
        <ChatComposer inputRef={input} draft={entry.draft} images={entry.images ?? []} conversationId={conversationId} settings={settings} context={editing.context} contextSelected={editing.contextSelected}
          pending={pending} loading={loading} imageBusy={imageBusy} modelBusy={switchingModel || model.restoring} modelValue={model.value} models={model.options} modelDisabled={busy || !!activeConversation}
          sendDisabled={busy || imageBusy || loading || switchingModel || model.restoring || model.blocked || !!activeConversation && activeConversation !== conversationId || !entry.draft.trim() && !entry.images?.length || vision === 'unsupported' && !!entry.images?.length}
          generating={!!snapshot?.busy} canStop={!!snapshot?.canControl} vision={vision} hasSource={!!entry.conversation?.capture}
          onDraft={draft => update(key, { draft })} onFiles={files => void importFiles(files)} onPaste={() => void addImages(scope => window.snipvia.chatImages.paste(scope))} onUpload={() => void addImages(scope => window.snipvia.chatImages.choose(scope))}
          onScreenshot={() => void pickSource()} onSource={() => { if (entry.conversation) void addImages(scope => window.snipvia.chatImages.fromCapture(scope, entry.conversation!.id)); }} onRemove={image => void removeImage(image)} onModel={profile => void model.select(profile)} onSend={() => void send()} onStop={() => void stop()} />
        <p className="workspace-privacy">对话保存在本机，仅在发送时传给所选模型服务。</p>
      </div>
    </div>}</EditingPanel>
    {dragging && <div className="chat-image-drop-hint" role="status">松开以添加图片 · PNG / JPEG</div>}
    {sourcePicker && <Dialog label="添加已有截图" className="chat-image-source-picker" onClose={() => setSourcePicker(false)}><header><strong>添加已有截图</strong><IconButton icon="close" label="关闭截图选择" onClick={() => setSourcePicker(false)} /></header><p>只添加已保存的截图选区，不读取完整屏幕。</p><div>{sources.length ? sources.map(source => <Button key={source.id} disabled={imageBusy} onClick={() => { setSourcePicker(false); void addImages(scope => window.snipvia.chatImages.fromCapture(scope, source.id)); }}>{source.title}<small>{new Date(source.createdAt).toLocaleDateString()}</small></Button>) : <p>暂无已保存截图。</p>}</div></Dialog>}
  </section>;
}
