import { ChatResizeHandle } from './ChatResizeHandle';
import './quick-chat.css';
import { Button, IconButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import type { CSSProperties } from 'react';
import { AgentNotebookButton } from '../agent/AgentNotebook';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Capture, Message, ModelProfile, PublicSettings } from '../../../shared/contracts';
import type { AutoActionSnapshot, ScreenshotAction, ScreenshotContentType } from '../../../shared/screenshot-understanding';
import { credentialScope, modelProfileLabel } from '../../../shared/providers';
import { Icon } from '../components/Icon';
import { MarkdownMessage } from './MarkdownMessage';
import { AgentActivityLine, AgentChatMessages } from '../agent/AgentExecution';
import { useAgentExecution } from '../agent/useAgentExecution';

const contentTypeLabels: Record<ScreenshotContentType, string> = {
  error: '错误', code: '代码', text: '文本', table: '表格', ui: '界面', question: '问题', unknown: '图片'
};

function autoActive(state: AutoActionSnapshot | null) {
  return !!state && ['analyzing', 'recommended', 'executing', 'streaming'].includes(state.state);
}

export function QuickChat() {
  const [expanded, setExpanded] = useState(false);
  const [changingLayout, setChangingLayout] = useState(false);
  const [split, setSplit] = useState(42);
  const [zoomed, setZoomed] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [imageSaved, setImageSaved] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [actions, setActions] = useState<ScreenshotAction[]>([]);
  const [autoAction, setAutoAction] = useState<AutoActionSnapshot | null>(null);
  const [question, setQuestion] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [predictionStarting, setPredictionStarting] = useState(false);
  const [streamedAnswer, setStreamedAnswer] = useState('');
  const [switchingModel, setSwitchingModel] = useState(false);
  const [error, setError] = useState('');
  const [performanceSessionId, setPerformanceSessionId] = useState<string | undefined>(window.snipvia.performance.initialSessionId ?? undefined);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const currentCaptureId = useRef<string | null>(null);
  const chatStateRequest = useRef(0);
  const pendingQuestion = useRef('');
  const submitInFlight = useRef(false);
  const copyInFlight = useRef(false);
  const claimedByUser = useRef(false);
  const refreshedOperations = useRef(new Set<string>());
  const manualBusyRef = useRef(false);
  const autoActionRef = useRef<AutoActionSnapshot | null>(null);
  const performanceSessionIdRef = useRef<string | undefined>(window.snipvia.performance.initialSessionId ?? undefined);
  const agent = useAgentExecution(capture?.id, () => { void refreshChatState(); }, setError);
  const agentRef = useRef(agent); agentRef.current = agent;

  async function refreshChatState(silent = false) {
    const request = ++chatStateRequest.current;
    const result = await window.snipvia.chat.state();
    if (request !== chatStateRequest.current) return;
    if (!result.ok) { if (!silent) setError(result.error); return; }
    currentCaptureId.current = result.value.capture.id;
    setCapture(result.value.capture);
    setMessages(result.value.messages);
    setAutoAction(result.value.autoAction ?? null);
    autoActionRef.current = result.value.autoAction ?? null;
    const sessionId = result.value.performanceSessionId ?? result.value.capture.performanceSessionId;
    performanceSessionIdRef.current = sessionId;
    setPerformanceSessionId(sessionId);
  }

  useEffect(() => {
    const initialSessionId = window.snipvia.performance.initialSessionId;
    if (initialSessionId) {
      window.snipvia.performance.mark(initialSessionId, 'react_mount', { page: 'quick-chat' });
      window.snipvia.performance.mark(initialSessionId, 'page_component_mount', { page: 'quick-chat' });
    }
    void refreshChatState(true);
    const stopCapture = window.snipvia.capture.onChanged(value => {
      if (currentCaptureId.current !== value.id) {
        currentCaptureId.current = value.id; setCapture(value); setMessages([]); setAutoAction(null); setQuestion('');
      }
      setError(''); void refreshChatState();
    });
    void window.snipvia.settings.get().then((result) => result.ok ? setSettings(result.value) : setError(result.error));
    void window.snipvia.autoAction.actions().then((result) => result.ok ? setActions(result.value) : setError(result.error));
    const stopSettings = window.snipvia.settings.onChanged((value) => {
      setSettings(value);
      void window.snipvia.autoAction.actions().then((result) => result.ok ? setActions(result.value) : setError(result.error));
    });
    const stopAuto = window.snipvia.autoAction.onChanged((state) => {
      if (currentCaptureId.current && state.captureId !== currentCaptureId.current) return;
      autoActionRef.current = state;
      setAutoAction(state);
      if (state.state === 'done' && !refreshedOperations.current.has(state.operationId)) {
        refreshedOperations.current.add(state.operationId);
        void refreshChatState();
      }
    });
    const stopStream = window.snipvia.chat.onStream((event) => {
      if (currentCaptureId.current && event.captureId !== currentCaptureId.current) return;
      if (event.type === 'start') {
        manualBusyRef.current = true;
        setManualBusy(true);
        setStreamedAnswer('');
      } else if (event.type === 'delta') {
        setStreamedAnswer((previous) => previous + (event.delta ?? ''));
      } else if (event.type === 'complete' && event.message) {
        setMessages((previous) => [...previous, event.message!]);
        setStreamedAnswer('');
        manualBusyRef.current = false;
        setManualBusy(false);
        pendingQuestion.current = '';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.snipvia.performance.mark(performanceSessionIdRef.current, 'chat_response_visible');
        }));
      } else if (event.type === 'error') {
        setError(event.error ?? '请求失败');
        setQuestion(pendingQuestion.current);
        setMessages((previous) => previous.at(-1)?.role === 'user' && previous.at(-1)?.content === pendingQuestion.current ? previous.slice(0, -1) : previous);
        setStreamedAnswer('');
        manualBusyRef.current = false;
        setManualBusy(false);
      }
    });
    const stopError = window.snipvia.capture.onError(setError);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (agentRef.current.busy) { void agentRef.current.stop(); return; }
      if (manualBusyRef.current || autoActive(autoActionRef.current)) void window.snipvia.autoAction.cancel();
      else void window.snipvia.autoAction.close();
    };
    window.addEventListener('keydown', keyDown);
    window.snipvia.window.ready('quick-chat');
    return () => {
      stopCapture();
      stopSettings();
      stopAuto();
      stopStream();
      stopError();
      window.removeEventListener('keydown', keyDown);
    };
  }, []);

  useEffect(() => { end.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [messages, manualBusy, streamedAnswer, autoAction?.content, agent.snapshot?.revision]);
  useEffect(() => { if (capture?.id) input.current?.focus(); }, [capture?.id]);

  const selectedAction = useMemo(() => actions.find((action) => action.id === autoAction?.actionId), [actions, autoAction?.actionId]);
  const isAutoActive = autoActive(autoAction);
  const continuedCapture = !!capture?.continuesConversation;
  const awaitingInput = !continuedCapture && (autoAction?.state === 'awaiting_input' || autoAction?.state === 'error');

  async function toggleLayout() {
    if (changingLayout) return;
    setChangingLayout(true);
    try {
      const result = await window.snipvia.chat.setExpanded(!expanded);
      if (result.ok) { setExpanded(!expanded); requestAnimationFrame(() => input.current?.focus()); }
      else setError(result.error);
    } catch { setError('无法切换布局，请重试'); }
    finally { setChangingLayout(false); }
  }

  async function copyImage() {
    if (copyInFlight.current) return;
    copyInFlight.current = true;
    try {
      const result = await window.snipvia.pin.copy();
      if (!result.ok) setError(result.error);
    } catch { setError('复制截图失败'); }
    finally { copyInFlight.current = false; }
  }

  async function saveImage() {
    if (savingImage) return;
    setSavingImage(true);
    try {
      const result = await window.snipvia.chat.saveImage();
      if (result.ok) setImageSaved(result.value); else setError(result.error);
    } catch { setError('保存图片失败，请重试'); }
    finally { setSavingImage(false); }
  }

  async function switchModel(profile: ModelProfile) {
    if (!settings || switchingModel || agent.busy) return;
    if (manualBusy || isAutoActive) await window.snipvia.autoAction.cancel();
    setSwitchingModel(true);
    setError('');
    const result = await window.snipvia.settings.save({
      ...profile,
      shortcut: settings.shortcut,
      continueShortcut: settings.continueShortcut,
      editorShortcut: settings.editorShortcut,
      predictionBranches: settings.predictionBranches
    });
    if (result.ok) setSettings(result.value);
    else setError(result.error);
    setSwitchingModel(false);
  }

  async function claimForUser(value: string) {
    setQuestion(value);
    if (!value.trim() || claimedByUser.current || !isAutoActive) return;
    claimedByUser.current = true;
    await window.snipvia.autoAction.userIntent();
    requestAnimationFrame(() => input.current?.focus());
  }

  async function send() {
    if (!capture || manualBusy || agent.busy || switchingModel || submitInFlight.current) return;
    const text = question.trim();
    if (!text) {
      if (!awaitingInput) return;
      submitInFlight.current = true; setPredictionStarting(true); setError('');
      try {
        const result = await window.snipvia.autoAction.start(capture.id);
        if (!result.ok) setError(result.error);
      } catch { setError('无法开始分析，请重试'); }
      finally { submitInFlight.current = false; setPredictionStarting(false); }
      return;
    }
    submitInFlight.current = true;
    try {
      if (agent.enabled) {
        setError('');
        if (await agent.start(text)) setQuestion('');
        return;
      }
      const sessionId = performanceSessionId ?? capture.performanceSessionId;
      window.snipvia.performance.mark(sessionId, 'chat_send_clicked');
      setError('');
      setQuestion('');
      pendingQuestion.current = text;
      claimedByUser.current = true;
      setMessages((previous) => [...previous, { role: 'user', content: text, createdAt: new Date().toISOString() }]);
      window.snipvia.performance.mark(sessionId, 'chat_send_ipc_start');
      const result = await window.snipvia.chat.stream({ captureId: capture.id, question: text, performanceSessionId: sessionId });
      window.snipvia.performance.mark(sessionId, 'chat_renderer_received');
      if (!result.ok) {
        setError(result.error);
        setQuestion(text);
        setMessages((previous) => previous.slice(0, -1));
        pendingQuestion.current = '';
        manualBusyRef.current = false;
        setManualBusy(false);
      } else {
        manualBusyRef.current = true;
        setManualBusy(true);
      }
    } finally { submitInFlight.current = false; }
  }

  const statusText = autoAction?.state === 'analyzing'
    ? '正在预测分支'
    : autoAction?.state === 'recommended'
      ? `正在准备${selectedAction?.label ?? '处理截图'}`
      : autoAction?.state === 'executing' || autoAction?.state === 'streaming'
        ? selectedAction?.runningLabel ?? '正在处理…'
        : '正在分析任务';
  const predictedBranch = !continuedCapture && autoAction?.analysis && autoAction.actionId !== 'ask-ai'
    ? selectedAction?.label ?? settings?.predictionBranches.find((branch) => branch.id === autoAction.actionId)?.label
      ?? `已识别${contentTypeLabels[autoAction.analysis.contentType]}`
    : null;
  const liveContent = streamedAnswer || (autoAction && autoAction.state !== 'done' ? autoAction.content : '');

  return <div className={`quick-chat quick-chat-v2 ${expanded ? 'is-expanded' : 'is-compact'}`} data-mode={expanded ? 'expanded' : 'compact'} onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'e' && !document.querySelector('dialog[open]')) {
      event.preventDefault(); void toggleLayout();
    }
  }}>
    <header className="quick-chat-header">
      <span className="quick-chat-brand"><Icon name="brand" size={17} /> 截然</span>
      <Button className="quick-header-save" variant="quiet" disabled={!capture || savingImage} onClick={() => void saveImage()}>{savingImage ? '保存中…' : imageSaved ? '已保存' : '保存图片'}</Button>
      <span className="quick-header-spacer" />
      {predictedBranch && <span className="quick-prediction-label" aria-label="预测分支" title={`预测分支：${predictedBranch}`}>{predictedBranch}</span>}
      <IconButton icon="sidebar" label={expanded ? '收起工作台' : '展开工作台'} aria-expanded={expanded} title="切换工作台（⌘⇧E / Ctrl+Shift+E）" disabled={changingLayout} onClick={() => void toggleLayout()} />
      <IconButton icon="arrow" label="返回软件" onClick={() => void window.snipvia.pin.returnToApp()} />
      <IconButton icon="close" label="关闭截图对话" onClick={() => void window.snipvia.autoAction.close()} />
    </header>
    <div ref={workspace} className="quick-chat-workspace" style={{ '--preview-width': `${split}%` } as CSSProperties}>
      {expanded && <section className="quick-capture-preview" aria-label="截图预览">
        <button className="quick-thumbnail" aria-label="放大截图" disabled={!capture} onClick={() => setZoomed(true)}>
          {capture && <img src={capture.dataUrl} alt="当前截图" draggable={false} />}
        </button>
      </section>}
      {expanded && <div className="quick-splitter" role="separator" aria-label="调整截图宽度" aria-orientation="vertical" aria-valuemin={28} aria-valuemax={60} aria-valuenow={split} tabIndex={0}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = workspace.current?.getBoundingClientRect();
          if (rect) setSplit(Math.max(28, Math.min(60, Math.round((event.clientX - rect.left) / rect.width * 100))));
        }}
        onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSplit((value) => Math.max(28, Math.min(60, value + (event.key === 'ArrowRight' ? 2 : -2)))); }
          if (event.key === 'Home') setSplit(28);
          if (event.key === 'End') setSplit(60);
        }} />}
      <section className="quick-conversation" aria-label="截图 AI 对话">
    <div className="quick-chat-messages" aria-live="polite">
      {continuedCapture && <p className="quick-context-note">新截图已接入上次对话 · 直接继续提问</p>}
      {messages.length === 0 && !liveContent && !isAutoActive && !manualBusy && !predictionStarting && !agent.snapshot?.runs.length && <div className="quick-chat-empty">
        <span>{awaitingInput ? '按 Enter，开始智能分析' : continuedCapture ? '结合上一次对话，围绕新截图继续提问' : '围绕这张截图直接提问'}</span>
        <small>{awaitingInput ? '也可以输入提示词，按你的要求直接对话。' : continuedCapture ? '本次不会执行意图分析。' : '预测分支可在设置中管理。'}</small>
      </div>}
      <AgentChatMessages messages={messages} controller={agent} compact onError={setError} />
      {liveContent && <article className="quick-message assistant streaming"><span>截然 · 正在生成</span><MarkdownMessage content={liveContent} onError={setError} /></article>}
      {!agent.busy && (isAutoActive || manualBusy || predictionStarting) && !liveContent && <article className="quick-message assistant quick-prediction-status"><span>截然 · Agent</span><AgentActivityLine label={predictionStarting ? '正在预测分支' : statusText} /></article>}
      <div ref={end} />
    </div>
    {(error || autoAction?.state === 'error') && <div className="quick-chat-error" role="alert"><Icon name="info" size={15} /><span>{error || autoAction?.error}</span><button type="button" aria-label="关闭错误提示" onClick={() => { setError(''); if (autoAction?.state === 'error') void window.snipvia.autoAction.cancel(); }}>×</button></div>}
    <div className="quick-workspace-row"><AgentNotebookButton controller={agent} disabled={!capture || manualBusy || isAutoActive || predictionStarting} /></div>
    <form className="quick-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <textarea ref={input} aria-label="悬浮对话问题" placeholder={awaitingInput ? '输入提示词，或直接按 Enter 自动分析…' : continuedCapture ? '结合之前的对话，继续问这张新截图…' : '关于这张截图，问点什么…'} value={question} disabled={!capture || agent.busy} onChange={(event) => void claimForUser(event.target.value)} onKeyDown={(event) => {
        if (awaitingInput && !question && !window.getSelection()?.toString() && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
          event.preventDefault();
          void copyImage();
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
          event.preventDefault(); if (!event.repeat) void send();
        }
      }} />
      <div className="quick-composer-footer">
        {settings && <label className="quick-model-picker">
          <select aria-label="悬浮对话模型" title={settings.model} value={credentialScope(settings)} disabled={switchingModel || agent.busy} onChange={(event) => {
            const profile = settings.configuredModels.find((item) => credentialScope(item) === event.target.value);
            if (profile) void switchModel(profile);
          }}>
            {settings.configuredModels.map((profile) => <option key={credentialScope(profile)} value={credentialScope(profile)}>{modelProfileLabel(profile, settings.configuredModels, true)}</option>)}
          </select>
          <Icon name="chevron" size={12} />
        </label>}
        {manualBusy || isAutoActive || agent.busy || predictionStarting
        ? <button type="button" className="quick-stop" aria-label="停止执行" title="停止（Esc）" disabled={agent.busy && !agent.snapshot?.canControl} onClick={() => void (agent.busy ? agent.stop() : window.snipvia.autoAction.cancel())}><Icon name="stop" size={20} /></button>
        : <button type="submit" className="quick-send" aria-label={awaitingInput && !question.trim() ? '开始分析' : '发送问题'} title={awaitingInput && !question.trim() ? '自动预测分支并开始对话（Enter）' : '发送（Enter）'} disabled={!capture || (!question.trim() && !awaitingInput) || switchingModel}><Icon name="arrowUp" size={21} /></button>}
      </div>
    </form>
      </section>
    </div>
    <ChatResizeHandle expanded={expanded} onError={setError} />
    {zoomed && capture && <Dialog label="截图放大预览" className="quick-image-dialog" onClose={() => setZoomed(false)}>
      <div className="quick-zoom-toolbar"><span>截图预览 · 原始比例</span><IconButton icon="close" label="关闭放大预览" data-initial-focus onClick={() => setZoomed(false)} /></div>
      <div className="quick-zoom-scroll"><img src={capture.dataUrl} alt="放大的截图" /></div>
    </Dialog>}
  </div>;
}
