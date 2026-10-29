import type { CapturePreferences } from '../shared/capture-preferences';
import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureOverlaySession, PinnedCaptureState, SnipviaAPI } from '../shared/contracts';
import type { ThemeSnapshot } from '../shared/appearance';

let theme = ipcRenderer.sendSync('appearance:initial') as ThemeSnapshot;
const themeListeners = new Set<(value: ThemeSnapshot) => void>();
function applyTheme(value: ThemeSnapshot) {
  if (!value || !['system', 'light', 'dark'].includes(value.mode) || !['light', 'dark'].includes(value.resolved)) return;
  if (theme && value.revision < theme.revision) return;
  theme = value;
  if (document.documentElement) {
    document.documentElement.dataset.theme = value.resolved;
    document.documentElement.dataset.themeMode = value.mode;
    if (location.hash === '#pin') document.documentElement.classList.add('floating-window');
    if (location.hash === '#shelf') document.documentElement.classList.add('shelf-window');
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
  quickTarget: {
    onSettingsChanged: callback => {
      const listener = (_event: Electron.IpcRendererEvent, value: import('../shared/quick-target').QuickTargetSettingsState) => callback(value);
      ipcRenderer.on('quick-target:settings-changed', listener);
      return () => { ipcRenderer.removeListener('quick-target:settings-changed', listener); };
    },
    settings: () => ipcRenderer.invoke('quick-target:settings'),
    configure: value => ipcRenderer.invoke('quick-target:configure', value),
    addApplication: () => ipcRenderer.invoke('quick-target:add-application'),
    addWebsite: value => ipcRenderer.invoke('quick-target:add-website', value),
    configureBrowser: value => ipcRenderer.invoke('quick-target:configure-browser', value),
    permissions: () => ipcRenderer.invoke('quick-target:permissions'),
    requestPermission: value => ipcRenderer.invoke('quick-target:request-permission', value),
    openPermissionSettings: value => ipcRenderer.invoke('quick-target:open-permission-settings', value),
    rename: value => ipcRenderer.invoke('quick-target:rename', value),
    remove: id => ipcRenderer.invoke('quick-target:remove', id),
    current: () => ipcRenderer.invoke('quick-target:current'),
    activate: value => ipcRenderer.invoke('quick-target:activate', value),
    rendered: value => ipcRenderer.invoke('quick-target:rendered', value),
    interaction: value => ipcRenderer.invoke('quick-target:interaction', value),
    dismiss: value => ipcRenderer.invoke('quick-target:dismiss', value),
    focus: () => ipcRenderer.invoke('quick-target:focus'),
    onChanged: callback => {
      const listener = (_event: Electron.IpcRendererEvent, value: import('../shared/quick-target').QuickTargetState) => callback(value);
      ipcRenderer.on('quick-target:changed', listener);
      return () => { ipcRenderer.removeListener('quick-target:changed', listener); };
    }
  },
  collection: {
    configure: value => ipcRenderer.invoke('collection:configure', value),
    widen: () => ipcRenderer.invoke('collection:widen'),
    reveal: () => ipcRenderer.invoke('collection:reveal'),
    edgeFinished: presentation => ipcRenderer.invoke('collection:edge-finished', presentation),
    openPreview: value => ipcRenderer.invoke('collection:open-preview', value),
    closePreview: () => ipcRenderer.invoke('collection:close-preview'),
    previewFinished: presentation => ipcRenderer.invoke('collection:preview-finished', presentation),
    resize: value => ipcRenderer.invoke('collection:resize', value),
    interaction: active => ipcRenderer.invoke('collection:interaction', active),
    feedbackFinished: value => ipcRenderer.invoke('collection:feedback-finished', value),
    hitRegions: value => ipcRenderer.invoke('collection:hit-regions', value),
    image: id => ipcRenderer.invoke('collection:image', id),
    copyAll: value => ipcRenderer.invoke('collection:copy-all', value),
    copyMerged: value => ipcRenderer.invoke('collection:copy-merged', value),
    export: value => ipcRenderer.invoke('collection:export', value),
    rendered: value => ipcRenderer.invoke('collection:rendered', value),
    reducedMotion: value => ipcRenderer.invoke('collection:reduced-motion', value),
    current: () => ipcRenderer.invoke('collection:current'),
    toggle: () => ipcRenderer.invoke('collection:toggle'),
    collapse: () => ipcRenderer.invoke('collection:collapse'),
    hide: () => ipcRenderer.invoke('collection:hide'),
    remove: id => ipcRenderer.invoke('collection:remove', id),
    reorder: value => ipcRenderer.invoke('collection:reorder', value),
    clear: () => ipcRenderer.invoke('collection:clear'),
    copy: id => ipcRenderer.invoke('collection:copy', id),
    startDrag: value => ipcRenderer.invoke('collection:start-drag', value),
    thumbnail: id => ipcRenderer.invoke('collection:thumbnail', id),
    preview: id => ipcRenderer.invoke('collection:preview', id),
    onChanged: callback => {
      const listener = (_event: Electron.IpcRendererEvent, state: import('../shared/collection').ShelfState) => callback(state);
      ipcRenderer.on('collection:changed', listener);
      return () => { ipcRenderer.removeListener('collection:changed', listener); };
    }
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
    set: async (mode) => {
      const result = await ipcRenderer.invoke('appearance:set', mode);
      if (result.ok) applyTheme(result.value);
      return result;
    },
    onChanged: (callback) => { themeListeners.add(callback); return () => { themeListeners.delete(callback); }; }
  },
  platform: process.platform,
  window: {
    ready: (role: 'capture' | 'pin' | 'shelf') => ipcRenderer.send('window:ready', role)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    saveShortcuts: (value) => ipcRenderer.invoke('settings:save-shortcuts', value),
    loginItem: () => ipcRenderer.invoke('settings:login-item'),
    setLoginItem: (enabled) => ipcRenderer.invoke('settings:set-login-item', enabled),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: CapturePreferences) => callback(settings);
      ipcRenderer.on('settings:changed', listener);
      return () => { ipcRenderer.removeListener('settings:changed', listener); };
    }
  },
  permissions: {
    screen: () => ipcRenderer.invoke('permissions:screen'),
    openScreenSettings: () => ipcRenderer.invoke('permissions:open-screen-settings'),
    revealApplication: () => ipcRenderer.invoke('permissions:reveal-application'),
    copyApplicationPath: () => ipcRenderer.invoke('permissions:copy-application-path')
  },
  browser: { openExternal: (url) => ipcRenderer.invoke('browser:open-external', url) },
  capture: {
    start: (mode) => ipcRenderer.invoke('capture:start', mode),
    editorCrop: (value) => ipcRenderer.invoke('capture:editor-crop', value),
    editorFinish: (value) => ipcRenderer.invoke('capture:editor-finish', value),
    frame: () => ipcRenderer.invoke('capture:frame'),
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
    onError: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on('capture:error', listener);
      return () => { ipcRenderer.removeListener('capture:error', listener); };
    }
  },
  pin: {
    current: () => ipcRenderer.invoke('pin:current'), close: () => ipcRenderer.invoke('pin:close'),
    copy: () => ipcRenderer.invoke('pin:copy'),
    move: value => ipcRenderer.invoke('pin:move', value),
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
    }
  },
  clipboard: { writeText: text => ipcRenderer.invoke('clipboard:write-text', text) },
  storage: { reveal: () => ipcRenderer.invoke('storage:reveal') },
  screenshots: {
    list: () => ipcRenderer.invoke('screenshots:list'),
    save: id => ipcRenderer.invoke('screenshots:save', id),
    delete: id => ipcRenderer.invoke('screenshots:delete', id),
    copy: id => ipcRenderer.invoke('screenshots:copy', id)
  },
  legacy: {
    read: () => ipcRenderer.invoke('legacy:read'),
    export: () => ipcRenderer.invoke('legacy:export'),
    importScreenshots: () => ipcRenderer.invoke('legacy:import-screenshots'),
    revealNotebook: id => ipcRenderer.invoke('legacy:reveal-notebook', id)
  },
  performance: {
    initialSessionId: initialPerformanceSessionId,
    mark: (sessionId, event, metadata) => {
      if (sessionId) ipcRenderer.send('performance:mark', { sessionId, event, metadata, sourceTimestampMs: performance.timeOrigin + performance.now() });
    },
    report: (sessionId) => ipcRenderer.invoke('performance:report', sessionId),
    startupReport: () => ipcRenderer.invoke('performance:startup-report'),
    frameQuality: (sessionId) => ipcRenderer.invoke('performance:frame-quality', sessionId),
    captureBackendStatus: () => ipcRenderer.invoke('performance:capture-backend-status')
  }
};
contextBridge.exposeInMainWorld('snipvia', api);
