import type { EditingContextRequest } from '../../shared/agent/editing';
import { Activity, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Capture, ConversationSummary, ModelProfile, PublicSettings, Result, ScheduleJobSummary } from '../../shared/contracts';
import type { NoteCreationRequest, NoteOpenRequest } from '../../shared/notes';
import { ChatWorkspace } from './chat/ChatWorkspace';
import { ChatSidebar } from './chat/ChatSidebar';
import { HistoryPanel } from './history/HistoryPanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { SchedulePanel } from './schedule/SchedulePanel';
import { ScreenPermissionCard } from './permissions/ScreenPermissionCard';
import { AppShell, type AppPage } from './components/AppShell';
import { LoadingState } from './components/ui/LoadingState';
import { formatAccelerator } from './settings/shortcut';

const scheduleSeenKey = 'snipvia.scheduleSeenAt';
const sidebarCollapsedKey = 'snipvia.sidebarCollapsed';
const NotesPanel = lazy(() => import('./notes/NotesPanel').then((module) => ({ default: module.NotesPanel })));

function storedScheduleSeenAt() {
  try { return window.localStorage.getItem(scheduleSeenKey) ?? ''; }
  catch { return ''; }
}

function storedSidebarCollapsed() {
  try { return window.localStorage.getItem(sidebarCollapsedKey) === 'true'; }
  catch { return false; }
}

function shortcutLabel(shortcut?: string) {
  return formatAccelerator(shortcut ?? 'CommandOrControl+Shift+Space', window.snipvia.platform);
}

export function App() {
  const [page, setPage] = useState<AppPage>('notes');
  const [visitedPages, setVisitedPages] = useState(() => new Set<AppPage>(['notes']));
  useEffect(() => { setVisitedPages((previous) => previous.has(page) ? previous : new Set([...previous, page])); }, [page]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedSidebarCollapsed);
  const [noteCreation, setNoteCreation] = useState<NoteCreationRequest | null>(null);
  const [noteOpen, setNoteOpen] = useState<NoteOpenRequest | null>(null);
  useEffect(() => window.snipvia.notes.onOpenRequested(request => { setNoteOpen(request); setNotesVisited(true); setPage('notes'); }), []);
  const [notesVisited, setNotesVisited] = useState(true);
  const notesFlush = useRef<(() => Promise<boolean>) | null>(null);
  useEffect(() => window.snipvia.notes.onFlushRequest((requestId) => {
    void (notesFlush.current?.() ?? Promise.resolve(true)).then((success) => {
      if (!success) { setNotesVisited(true); setPage('notes'); }
      return window.snipvia.notes.finishFlush(requestId, success);
    }).catch(() => { void window.snipvia.notes.finishFlush(requestId, false); });
  }), []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [newChatRequest, setNewChatRequest] = useState(0);
  const [chatStatus, setChatStatus] = useState<{ blocked: boolean; activeId: string | null }>({ blocked: false, activeId: null });
  const modelSwitchLock = useRef(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [historyItems, setHistoryItems] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [scheduleItems, setScheduleItems] = useState<ScheduleJobSummary[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSeenAt, setScheduleSeenAt] = useState(storedScheduleSeenAt);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [error, setError] = useState('');
  const [permissionDialog, setPermissionDialog] = useState(false);
  useEffect(() => window.snipvia.notes.onCreationRequested((request) => {
    setNoteCreation(request); setNotesVisited(true); setPage('notes');
    if (request.captureId) void window.snipvia.chat.state().then((result) => {
      if (result.ok && result.value.capture.id === request.captureId) {
        setConversationId(result.value.capture.conversationId);
      }
    });
  }), []);

  function changed(value: Capture) {
    setConversationId(value.conversationId); setError(''); setPage('chat');
    void refreshHistory();
  }
  async function refreshHistory() {
    setHistoryLoading(true);
    const result = await window.snipvia.history.list();
    if (result.ok) setHistoryItems(result.value);
    else setError(result.error);
    setHistoryLoading(false);
  }
  async function refreshSchedule() {
    setScheduleLoading(true);
    const result = await window.snipvia.schedule.list();
    if (result.ok) setScheduleItems(result.value);
    else setError(result.error);
    setScheduleLoading(false);
  }
  function captureError(message: string) {
    setError(message);
    void window.snipvia.permissions.screen().then((result) => {
      if (result.ok && result.value.supported && result.value.status !== 'granted') setPermissionDialog(true);
    });
  }
  useEffect(() => {
    void window.snipvia.settings.get().then((result) => result.ok ? setSettings(result.value) : setError(result.error));
    void window.snipvia.capture.current().then((result) => { if (result.ok && result.value) changed(result.value); });
    void refreshHistory();
    void refreshSchedule();
    const unsubscribeHistory = window.snipvia.history.onChanged(() => { void refreshHistory(); });
    const unsubscribeSettings = window.snipvia.settings.onChanged(setSettings);
    const unsubscribe = window.snipvia.capture.onChanged(changed);
    const unsubscribeResume = window.snipvia.capture.onResumeConversation((id) => { void openHistory(id); });
    const unsubscribeError = window.snipvia.capture.onError(captureError);
    const unsubscribeSchedule = window.snipvia.schedule.onChanged(() => { void refreshSchedule(); });
    const unsubscribeNavigate = window.snipvia.schedule.onNavigate(() => { setPage('schedule'); void refreshSchedule(); });
    return () => { unsubscribeHistory(); unsubscribeSettings(); unsubscribe(); unsubscribeResume(); unsubscribeError(); unsubscribeSchedule(); unsubscribeNavigate(); };
  }, []);
  useEffect(() => {
    if (page !== 'schedule' || scheduleItems.length === 0) return;
    const latest = scheduleItems.reduce((value, item) => Date.parse(item.updatedAt) > Date.parse(value) ? item.updatedAt : value, scheduleItems[0].updatedAt);
    if (latest === scheduleSeenAt) return;
    setScheduleSeenAt(latest);
    try { window.localStorage.setItem(scheduleSeenKey, latest); } catch { /* The in-memory state still clears the badge. */ }
  }, [page, scheduleItems, scheduleSeenAt]);

  const seenTime = scheduleSeenAt ? Date.parse(scheduleSeenAt) : 0;
  const unreadScheduleCount = scheduleItems.filter((item) => Date.parse(item.updatedAt) > seenTime).length;

  async function switchModel(profile: ModelProfile) {
    if (!settings || modelSwitchLock.current) throw new Error('模型正在切换，请稍后重试。');
    modelSwitchLock.current = true;
    setSwitchingModel(true); setError('');
    try {
      const result = await window.snipvia.settings.save({
        ...profile,
        shortcut: settings.shortcut,
        continueShortcut: settings.continueShortcut,
        editorShortcut: settings.editorShortcut,
        predictionBranches: settings.predictionBranches
      });
      if (result.ok) setSettings(result.value);
      else { setError(result.error); throw new Error(result.error); }
    } finally { modelSwitchLock.current = false; setSwitchingModel(false); }
  }

  async function openHistory(id: string): Promise<Result<void>> {
    setError('');
    const result = await window.snipvia.history.read(id);
    if (!result.ok) { setError(result.error); return result; }
    setConversationId(id); setPage('chat');
    return { ok: true, value: undefined };
  }

  async function deleteHistory(id: string): Promise<Result<void>> {
    const result = await window.snipvia.history.delete(id);
    if (!result.ok) { setError(result.error); return result; }
    if (conversationId === id) setConversationId(null);
    await refreshHistory();
    return { ok: true, value: undefined };
  }

  async function clearHistory(): Promise<Result<void>> {
    const result = await window.snipvia.history.clear();
    if (!result.ok) { setError(result.error); return result; }
    setConversationId(null);
    await refreshHistory();
    return { ok: true, value: undefined };
  }

  async function discuss(context: EditingContextRequest) {
    setError('');
    const created = await window.snipvia.history.create();
    if (!created.ok) { setError(created.error); return; }
    const selected = await window.snipvia.editing.select(created.value.id, context);
    if (!selected.ok) { setError(selected.error); return; }
    setConversationId(created.value.id); setPage('chat'); await refreshHistory();
  }

  function navigate(next: AppPage) {
    if (next === 'notes') setNotesVisited(true);
    if (next === 'schedule') void refreshSchedule();
    if (next === 'history') void refreshHistory();
    setPage(next);
  }

  function newChat() { setConversationId(null); setNewChatRequest(value => value + 1); setPage('chat'); }

  return <AppShell sidebarContent={<ChatSidebar items={historyItems} selected={conversationId} blocked={chatStatus.blocked || switchingModel} activeId={chatStatus.activeId} onSelect={id => { if (id) { setConversationId(id); setPage('chat'); } else newChat(); }} onDelete={deleteHistory} onHistory={() => navigate('history')} />} page={page} sidebarCollapsed={sidebarCollapsed} unreadScheduleCount={unreadScheduleCount} onNavigate={navigate} onToggleSidebar={() => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem(sidebarCollapsedKey, String(next)); } catch { /* Keep the in-memory preference when storage is unavailable. */ }
  }}>
      {notesVisited && <Suspense fallback={page === 'notes' ? <LoadingState>正在打开笔记…</LoadingState> : null}><NotesPanel openRequest={noteOpen} onOpenHandled={() => setNoteOpen(null)} active={page === 'notes'} flushRef={notesFlush} creationRequest={noteCreation} onCreationHandled={() => setNoteCreation(null)} onReturnToChat={() => setPage('chat')} onDiscuss={discuss} /></Suspense>}
      {error && <div className="error" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      {permissionDialog && <div className="permission-backdrop"><div className="permission-dialog" role="dialog" aria-modal="true" aria-label="录屏权限设置"><button className="permission-close" aria-label="关闭录屏权限提示" onClick={() => setPermissionDialog(false)}>×</button><ScreenPermissionCard onChange={(info) => { if (info.status === 'granted') setPermissionDialog(false); }} /></div></div>}
      {(page === 'settings' || visitedPages.has('settings')) && <Activity mode={page === 'settings' ? 'visible' : 'hidden'}>{settings ? <SettingsPanel settings={settings} onSaved={setSettings} onDiscuss={discuss} /> : <LoadingState>正在读取设置…</LoadingState>}</Activity>}
      {(page === 'history' || visitedPages.has('history')) && <Activity mode={page === 'history' ? 'visible' : 'hidden'}><HistoryPanel items={historyItems} loading={historyLoading} onOpen={openHistory} onDelete={deleteHistory} onClear={clearHistory} /></Activity>}
      {(page === 'schedule' || visitedPages.has('schedule')) && <Activity mode={page === 'schedule' ? 'visible' : 'hidden'}><SchedulePanel items={scheduleItems} loading={scheduleLoading} shortcut={shortcutLabel(settings?.shortcut)} onRefresh={refreshSchedule} onError={setError} /></Activity>}
      {(page === 'chat' || visitedPages.has('chat')) && <Activity mode={page === 'chat' ? 'visible' : 'hidden'}><ChatWorkspace conversationId={conversationId} items={historyItems} settings={settings} switchingModel={switchingModel} onSelect={setConversationId} onNew={newChat} newRequest={newChatRequest} onStatus={setChatStatus} onRefresh={refreshHistory} onSwitchModel={switchModel} onSettings={() => setPage('settings')} /></Activity>}
  </AppShell>;
}
