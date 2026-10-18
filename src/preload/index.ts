import { contextBridge, ipcRenderer } from 'electron';
import type { Capture, CaptureOverlaySession, PinnedCaptureState, PublicSettings, ReusableWindowRole, SnipviaAPI } from '../shared/contracts';
import type { AutoActionSnapshot, ChatStreamEvent } from '../shared/screenshot-understanding';
import type { AgentExecutionSnapshot, AgentTarget } from '../shared/agent/execution';
import type { PermissionRequest } from '../shared/agent/permission';
import type { ThemeSnapshot } from '../shared/appearance';

function agentReference(target: AgentTarget) { return typeof target === 'string' ? { captureId: target } : { conversationId: target.conversationId }; }

let theme = ipcRenderer.sendSync('appearance:initial') as ThemeSnapshot;
const themeListeners = new Set<(value: ThemeSnapshot) => void>();
function applyTheme(value: ThemeSnapshot) {
  if (!value || !['system', 'light', 'dark'].includes(value.mode) || !['light', 'dark'].includes(value.resolved)) return;
  if (theme && value.revision < theme.revision) return;
  theme = value;
  if (document.documentElement) {
    document.documentElement.dataset.theme = value.resolved;
    document.documentElement.dataset.themeMode = value.mode;
    const size = value.chatFontSize ?? 15;
    if (Number.isInteger(size) && size >= 12 && size <= 24) document.documentElement.style.setProperty('--chat-font-size', `${size}px`);
    if (['#pin', '#quick-chat'].includes(location.hash)) document.documentElement.classList.add('floating-window');
    if (location.hash === '#capture') document.documentElement.classList.add('capture-window');
  }
  for (const listener of themeListeners) listener(value);
}
ipcRenderer.on('appearance:changed', (_event, value: ThemeSnapshot) => applyTheme(value));
document.addEventListener('DOMContentLoaded', () => applyTheme(theme), { once: true });

const performanceArgument = '--snipvia-performance-session=';
const initialPerformanceSessionId = process.argv.find((argument) => argument.startsWith(performanceArgument))?.slice(performanceArgument.length) || null;
if (initialPerformanceSessionId) {
  ipcRenderer.send('performance:mark', {
    sessionId: initialPerformanceSessionId,
    event: 'renderer_boot_start',
    metadata: { page: location.hash ? location.hash.slice(1) : 'bootstrap' }
  });
}

const api: SnipviaAPI = {
  chatImages: {
    sources: () => ipcRenderer.invoke('chat-images:sources'),
    choose: conversationId => ipcRenderer.invoke('chat-images:choose', { conversationId }),
    import: (conversationId, files) => ipcRenderer.invoke('chat-images:import', { conversationId, files }),
    paste: conversationId => ipcRenderer.invoke('chat-images:paste', { conversationId }),
    fromCapture: (conversationId, sourceConversationId) => ipcRenderer.invoke('chat-images:capture', { conversationId, sourceConversationId }),
    preview: (conversationId, imageId) => ipcRenderer.invoke('chat-images:preview', { conversationId, imageId }),
    remove: (conversationId, imageId) => ipcRenderer.invoke('chat-images:remove', { conversationId, imageId }),
    bind: (conversationId, imageIds) => ipcRenderer.invoke('chat-images:bind', { conversationId, imageIds }),
    capability: () => ipcRenderer.invoke('chat-images:capability')
  },
  prediction: {
    get: () => ipcRenderer.invoke('prediction-settings:get'),
    save: value => ipcRenderer.invoke('prediction-settings:save', value),
    openConsole: () => ipcRenderer.invoke('prediction-settings:open-console')
  },
  updates: {
    current: () => ipcRenderer.invoke('updates:current'),
    check: () => ipcRenderer.invoke('updates:check'),
    openRelease: () => ipcRenderer.invoke('updates:open-release'),
    download: () => ipcRenderer.invoke('updates:download'),
    restartAndInstall: () => ipcRenderer.invoke('updates:restart-install'),
    onChanged: callback => {
      const listener = (_event: Electron.IpcRendererEvent, state: import('../shared/updates').UpdateState) => callback(state);
      ipcRenderer.on('updates:changed', listener);
      return () => { ipcRenderer.removeListener('updates:changed', listener); };
    }
  },
  appearance: {
    current: () => ({ ...theme }),
    setChatFontSize: async (size) => {
      const result = await ipcRenderer.invoke('appearance:set-chat-font-size', size);
      if (result.ok) applyTheme(result.value);
      return result;
    },
    set: async (mode) => {
      const result = await ipcRenderer.invoke('appearance:set', mode);
      if (result.ok) applyTheme(result.value);
      return result;
    },
    onChanged: (callback) => { themeListeners.add(callback); return () => { themeListeners.delete(callback); }; }
  },
  notes: {
    copyCode: (content) => ipcRenderer.invoke('notes:copy-code', content),
    onOpenRequested: (callback) => { const listener = (_event: Electron.IpcRendererEvent, value: import('../shared/notes').NoteOpenRequest) => callback(value);
      ipcRenderer.on('notes:open-requested', listener); return () => ipcRenderer.removeListener('notes:open-requested', listener); },
    requestCreation: (captureId) => ipcRenderer.invoke('notes:request-creation', { captureId }),
    onCreationRequested: (callback) => { const listener = (_event: Electron.IpcRendererEvent, request: import('../shared/notes').NoteCreationRequest) => callback(request);
      ipcRenderer.on('notes:creation-requested', listener); return () => { ipcRenderer.removeListener('notes:creation-requested', listener); }; },
    onFlushRequest: (callback) => { const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
      ipcRenderer.on('notes:flush-request', listener); return () => { ipcRenderer.removeListener('notes:flush-request', listener); }; },
    finishFlush: (requestId, success) => ipcRenderer.invoke('notes:finish-flush', { requestId, success }),
    state: () => ipcRenderer.invoke('notes:state'),
    chooseLocation: () => ipcRenderer.invoke('notes:choose-location'),
    create: (token, name) => ipcRenderer.invoke('notes:create', { token, name }),
    open: () => ipcRenderer.invoke('notes:open'), select: (id) => ipcRenderer.invoke('notes:select', id),
    unlink: (id) => ipcRenderer.invoke('notes:unlink', id),
    entries: (id) => ipcRenderer.invoke('notes:entries', id),
    read: (notebookId, path) => ipcRenderer.invoke('notes:read', { notebookId, path }),
    save: (notebookId, document) => ipcRenderer.invoke('notes:save', { notebookId, ...document }),
    createEntry: (notebookId, parent, name, kind) => ipcRenderer.invoke('notes:create-entry', { notebookId, parent, name, kind }),
    move: (notebookId, path, destination) => ipcRenderer.invoke('notes:move', { notebookId, path, destination }),
    trash: (notebookId, path) => ipcRenderer.invoke('notes:trash', { notebookId, path }),
    backlinks: (notebookId, path) => ipcRenderer.invoke('notes:backlinks', { notebookId, path }),
    importAssets: (id) => ipcRenderer.invoke('notes:import-assets', id),
    addAsset: (notebookId, name, bytes) => ipcRenderer.invoke('notes:add-asset', { notebookId, name, bytes }),
    image: (notebookId, path) => ipcRenderer.invoke('notes:image', { notebookId, path }),
    reveal: (notebookId, path) => ipcRenderer.invoke('notes:reveal', { notebookId, path }),
    export: (id) => ipcRenderer.invoke('notes:export', id),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
      ipcRenderer.on('notes:changed', listener); return () => { ipcRenderer.removeListener('notes:changed', listener); }; }
  },
  editing: {
    state: conversationId => ipcRenderer.invoke('editing:state', { conversationId }),
    select: (conversationId, context) => ipcRenderer.invoke('editing:select', { conversationId, context }),
    preview: (conversationId, proposalId) => ipcRenderer.invoke('editing:preview', { conversationId, proposalId }),
    apply: (conversationId, proposalId, digest) => ipcRenderer.invoke('editing:apply', { conversationId, proposalId, digest }),
    cancel: (conversationId, proposalId) => ipcRenderer.invoke('editing:cancel', { conversationId, proposalId }),
    openNote: (conversationId, proposalId) => ipcRenderer.invoke('editing:open-note', { conversationId, proposalId }),
    onChanged: callback => { const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value); ipcRenderer.on('editing:changed', listener); return () => ipcRenderer.removeListener('editing:changed', listener); }
  },
  agent: {
    workspaceState: (conversationId) => ipcRenderer.invoke('agent:workspace-state', { conversationId }),
    workspaceStart: (conversationId, question, regenerate = false, imageIds = []) => ipcRenderer.invoke('agent:workspace-start', { conversationId, question, regenerate, imageIds }),
    workspaceStop: (conversationId, runId) => ipcRenderer.invoke('agent:workspace-stop', { conversationId, runId }),
    openNote: (captureId, changeId) => ipcRenderer.invoke('agent:note-open', { ...agentReference(captureId), changeId }),
    noteDiff: (captureId, changeId) => ipcRenderer.invoke('agent:note-diff', { ...agentReference(captureId), changeId }),
    noteUndoState: (captureId, changeId) => ipcRenderer.invoke('agent:note-undo-state', { ...agentReference(captureId), changeId }),
    undoNotes: (captureId, changeId) => ipcRenderer.invoke('agent:note-undo', { ...agentReference(captureId), changeId }),
    state: (captureId) => ipcRenderer.invoke('agent:state', { captureId }),
    notebooks: (captureId) => ipcRenderer.invoke('agent:notebooks', { captureId }),
    selectNotebook: (captureId, notebookId) => ipcRenderer.invoke('agent:notebook', { captureId, notebookId }),
    start: (captureId, question) => ipcRenderer.invoke('agent:start', { captureId, question }),
    stop: (captureId, runId) => ipcRenderer.invoke('agent:stop', { captureId, runId }),
    decide: (captureId, runId, requestId, decision) => ipcRenderer.invoke('agent:decide', { captureId, runId, requestId, decision }),
    diff: (captureId, runId, stepId) => ipcRenderer.invoke('agent:diff', { captureId, runId, stepId }),
    sourceIcon: (captureId, url) => ipcRenderer.invoke('agent:source-icon', { captureId, url }),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: AgentExecutionSnapshot) => callback(value);
      ipcRenderer.on('agent:changed', listener);
      return () => { ipcRenderer.removeListener('agent:changed', listener); };
    }
  },
  agentPermissions: {
    current: () => ipcRenderer.invoke('agent:permission:current'),
    decide: (requestId, decision) => ipcRenderer.invoke('agent:permission:decide', { requestId, decision }),
    clearRemembered: () => ipcRenderer.invoke('agent:permission:clear'),
    onRequest: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, request: PermissionRequest) => callback(request);
      ipcRenderer.on('agent:permission:request', listener);
      return () => { ipcRenderer.removeListener('agent:permission:request', listener); };
    }
  },
  platform: process.platform,
  models: {
    list: value => ipcRenderer.invoke('models:list', value),
    add: value => ipcRenderer.invoke('models:add', value),
    testVision: value => ipcRenderer.invoke('models:test-vision', value)
  },
  window: {
    ready: (role: ReusableWindowRole) => ipcRenderer.send('window:ready', role)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (value) => ipcRenderer.invoke('settings:save', value),
    loginItem: () => ipcRenderer.invoke('settings:login-item'),
    setLoginItem: (enabled) => ipcRenderer.invoke('settings:set-login-item', enabled),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: PublicSettings) => callback(settings);
      ipcRenderer.on('settings:changed', listener);
      return () => { ipcRenderer.removeListener('settings:changed', listener); };
    }
  },
  browser: { openExternal: (url) => ipcRenderer.invoke('browser:open-external', url) },
  permissions: {
    screen: () => ipcRenderer.invoke('permissions:screen'),
    openScreenSettings: () => ipcRenderer.invoke('permissions:open-screen-settings'),
    revealApplication: () => ipcRenderer.invoke('permissions:reveal-application'),
    copyApplicationPath: () => ipcRenderer.invoke('permissions:copy-application-path')
  },
  capture: {
    start: (mode) => ipcRenderer.invoke('capture:start', mode),
    editorCrop: (value) => ipcRenderer.invoke('capture:editor-crop', value),
    editorFinish: (value) => ipcRenderer.invoke('capture:editor-finish', value), import: () => ipcRenderer.invoke('capture:import'),
    current: () => ipcRenderer.invoke('capture:current'), frame: () => ipcRenderer.invoke('capture:frame'),
    finish: (rect) => ipcRenderer.invoke('capture:finish', rect), cancel: () => ipcRenderer.invoke('capture:cancel'),
    sessionShellRendered: (sessionId) => ipcRenderer.invoke('capture:session-shell-rendered', sessionId),
    sessionRendered: (sessionId) => ipcRenderer.invoke('capture:session-rendered', sessionId),
    sessionVisible: (sessionId) => ipcRenderer.invoke('capture:session-visible', sessionId),
    onSession: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, session: CaptureOverlaySession) => callback(session);
      ipcRenderer.on('capture:new-session', listener);
      return () => { ipcRenderer.removeListener('capture:new-session', listener); };
    },
    onFrameReady: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) => callback(sessionId);
      ipcRenderer.on('capture:frame-ready', listener);
      return () => { ipcRenderer.removeListener('capture:frame-ready', listener); };
    },
    onResetSession: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('capture:reset-session', listener);
      return () => { ipcRenderer.removeListener('capture:reset-session', listener); };
    },
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, capture: Capture) => callback(capture);
      ipcRenderer.on('capture:changed', listener);
      return () => { ipcRenderer.removeListener('capture:changed', listener); };
    },
    onResumeConversation: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
      ipcRenderer.on('capture:resume-conversation', listener);
      return () => { ipcRenderer.removeListener('capture:resume-conversation', listener); };
    },
    onError: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on('capture:error', listener);
      return () => { ipcRenderer.removeListener('capture:error', listener); };
    }
  },
  pin: {
    current: () => ipcRenderer.invoke('pin:current'), close: () => ipcRenderer.invoke('pin:close'),
    copy: () => ipcRenderer.invoke('pin:copy'),
    startChat: () => ipcRenderer.invoke('pin:start-chat'),
    returnToApp: () => ipcRenderer.invoke('pin:return-to-app'),
    sessionRendered: (sessionId) => ipcRenderer.invoke('pin:session-rendered', sessionId),
    sessionVisible: (sessionId) => ipcRenderer.invoke('pin:session-visible', sessionId),
    onSession: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: PinnedCaptureState) => callback(state);
      ipcRenderer.on('pin:new-session', listener);
      return () => { ipcRenderer.removeListener('pin:new-session', listener); };
    },
    onResetSession: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('pin:reset-session', listener);
      return () => { ipcRenderer.removeListener('pin:reset-session', listener); };
    },
    onChatState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, active: boolean) => callback(active);
      ipcRenderer.on('pin:chat-state', listener);
      return () => { ipcRenderer.removeListener('pin:chat-state', listener); };
    }
  },
  chat: {
    state: () => ipcRenderer.invoke('chat:state'),
    setExpanded: (expanded) => ipcRenderer.invoke('chat:set-expanded', expanded),
    resize: size => ipcRenderer.invoke('chat:resize', size),
    saveImage: () => ipcRenderer.invoke('chat:save-image'),
    send: (value) => ipcRenderer.invoke('chat:send', value),
    stream: (value) => ipcRenderer.invoke('chat:stream', value),
    cancel: () => ipcRenderer.invoke('chat:cancel'),
    onStream: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: ChatStreamEvent) => callback(value);
      ipcRenderer.on('chat:stream-event', listener);
      return () => { ipcRenderer.removeListener('chat:stream-event', listener); };
    }
  },
  autoAction: {
    actions: () => ipcRenderer.invoke('auto-action:actions'),
    state: () => ipcRenderer.invoke('auto-action:state'),
    start: (captureId) => ipcRenderer.invoke('auto-action:start', captureId),
    cancel: () => ipcRenderer.invoke('auto-action:cancel'),
    userIntent: () => ipcRenderer.invoke('auto-action:user-intent'),
    close: () => ipcRenderer.invoke('auto-action:close'),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: AutoActionSnapshot) => callback(value);
      ipcRenderer.on('auto-action:changed', listener);
      return () => { ipcRenderer.removeListener('auto-action:changed', listener); };
    }
  },
  history: {
    onChanged: callback => { const listener = () => callback(); ipcRenderer.on('history:changed', listener); return () => ipcRenderer.removeListener('history:changed', listener); },
    create: () => ipcRenderer.invoke('history:create'),
    read: (id) => ipcRenderer.invoke('history:read', id),
    rename: (id, title) => ipcRenderer.invoke('history:rename', { id, title }),
    list: () => ipcRenderer.invoke('history:list'), open: (id) => ipcRenderer.invoke('history:open', id),
    delete: (id) => ipcRenderer.invoke('history:delete', id), clear: () => ipcRenderer.invoke('history:clear')
  },
  schedule: {
    list: () => ipcRenderer.invoke('schedule:list'), open: (id) => ipcRenderer.invoke('schedule:open', id),
    save: (value) => ipcRenderer.invoke('schedule:save', value), delete: (id) => ipcRenderer.invoke('schedule:delete', id),
    macCalendars: () => ipcRenderer.invoke('schedule:mac-calendars'),
    macReminderLists: () => ipcRenderer.invoke('schedule:mac-reminder-lists'),
    saveToMac: (value) => ipcRenderer.invoke('schedule:save-to-mac', value),
    saveToReminders: (value) => ipcRenderer.invoke('schedule:save-to-reminders', value),
    onChanged: (callback) => {
      const listener = () => callback(); ipcRenderer.on('schedule:changed', listener);
      return () => { ipcRenderer.removeListener('schedule:changed', listener); };
    },
    onNavigate: (callback) => {
      const listener = () => callback(); ipcRenderer.on('schedule:navigate', listener);
      return () => { ipcRenderer.removeListener('schedule:navigate', listener); };
    }
  },
  performance: {
    initialSessionId: initialPerformanceSessionId,
    mark: (sessionId, event, metadata) => {
      if (sessionId) ipcRenderer.send('performance:mark', { sessionId, event, metadata });
    },
    report: (sessionId) => ipcRenderer.invoke('performance:report', sessionId),
    startupReport: () => ipcRenderer.invoke('performance:startup-report'),
    frameQuality: (sessionId) => ipcRenderer.invoke('performance:frame-quality', sessionId),
    captureBackendStatus: () => ipcRenderer.invoke('performance:capture-backend-status')
  }
};
contextBridge.exposeInMainWorld('snipvia', api);
