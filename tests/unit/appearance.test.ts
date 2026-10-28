import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMainEvent } from 'electron';
import tokens from '../../src/shared/design-tokens.json';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const runtime = vi.hoisted(() => ({ mode: 'system' as 'system' | 'light' | 'dark', osDark: false, windows: [] as unknown[], failSave: false }));
vi.mock('../../src/main/storage/settings', () => ({
  appearanceMode: () => runtime.mode,
  saveAppearanceMode: (mode: typeof runtime.mode) => { if (runtime.failSave) throw new Error('disk unavailable'); runtime.mode = mode; }
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { app: new EventEmitter(), BrowserWindow: { getAllWindows: () => runtime.windows }, nativeTheme: Object.assign(new EventEmitter(), {
    themeSource: 'system'
  }) };
});
import { app, nativeTheme } from 'electron';
import { AppearanceService } from '../../src/main/appearance';

function createWindow(background = '#ffffff') {
  const contents = Object.assign(new EventEmitter(), { ipc: new EventEmitter(), mainFrame: {}, send: vi.fn() });
  return { background, webContents: contents, isDestroyed: vi.fn(() => false), getBackgroundColor() { return this.background; },
    setBackgroundColor: vi.fn(function(this: { background: string }, value: string) { this.background = value; }), setTitleBarOverlay: vi.fn() };
}

beforeEach(() => {
  runtime.mode = 'system'; runtime.osDark = false; runtime.windows = []; runtime.failSave = false;
  app.removeAllListeners(); nativeTheme.removeAllListeners(); nativeTheme.themeSource = 'system';
  Object.defineProperty(nativeTheme, 'shouldUseDarkColors', { configurable: true, get: () => nativeTheme.themeSource === 'dark' || (nativeTheme.themeSource === 'system' && runtime.osDark) });
});

describe('main-owned appearance', () => {
  it('follows runtime system changes, respects explicit overrides, and themes all opaque windows', () => {
    const main = createWindow(); const permission = createWindow(); const transparent = createWindow('#00000000');
    runtime.windows = [main, permission, transparent];
    const service = new AppearanceService(() => main as unknown as BrowserWindow); service.start();
    expect(service.current()).toMatchObject({ mode: 'system', resolved: 'light' });
    runtime.osDark = true; nativeTheme.emit('updated');
    expect(service.current()).toMatchObject({ mode: 'system', resolved: 'dark' });
    expect(main.background).toBe(tokens.dark['bg-window']); expect(permission.background).toBe(tokens.dark['bg-window']);
    expect(transparent.background).toBe('#00000000');
    expect(transparent.webContents.send).toHaveBeenLastCalledWith('appearance:changed', service.current());
    service.setMode('light'); nativeTheme.emit('updated');
    expect(service.current()).toMatchObject({ mode: 'light', resolved: 'light' });
    expect(runtime.mode).toBe('light');
    service.setMode('system'); expect(service.current().resolved).toBe('dark');
  });

  it('preserves the macOS transparent native background whose reported color omits alpha', () => {
    const transparent = createWindow('#000000'); runtime.windows = [transparent];
    const service = new AppearanceService(() => undefined); service.start(); service.setMode('dark');
    expect(transparent.setBackgroundColor).not.toHaveBeenCalled();
  });

  it('bootstraps newly created windows synchronously and denies foreign frames', () => {
    runtime.mode = 'dark'; const service = new AppearanceService(() => undefined); service.start();
    const window = createWindow(); runtime.windows = [window]; app.emit('browser-window-created', {}, window);
    expect(window.background).toBe(tokens.dark['bg-window']);
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as unknown as IpcMainEvent;
    window.webContents.ipc.emit('appearance:initial', event);
    expect(event.returnValue).toEqual(service.current());
    const foreign = { sender: window.webContents, senderFrame: {} } as unknown as IpcMainEvent;
    window.webContents.ipc.emit('appearance:initial', foreign); expect(foreign.returnValue).toBeNull();
    window.webContents.emit('did-finish-load');
    expect(window.webContents.send).toHaveBeenLastCalledWith('appearance:changed', service.current());
  });

  it('does not apply an invalid or unsuccessfully persisted preference', () => {
    const service = new AppearanceService(() => undefined); service.start(); const previous = service.current();
    expect(() => service.setMode('invalid')).toThrow(); expect(service.current()).toEqual(previous);
    runtime.failSave = true; expect(() => service.setMode('dark')).toThrow('disk unavailable');
    expect(service.current()).toEqual(previous); expect(nativeTheme.themeSource).toBe('system');
  });
});

it('defines matching light/dark tokens and keeps renderer CSS colors in the canonical palette', () => {
  expect(Object.keys(tokens.light).sort()).toEqual(Object.keys(tokens.dark).sort());
  const generated = readFileSync('src/renderer/src/design/tokens.css', 'utf8');
  for (const palette of [tokens.light, tokens.dark, tokens.metrics]) {
    for (const [name, value] of Object.entries(palette)) expect(generated, `Regenerate CSS after editing ${name}`).toContain(`--${name}: ${value};`);
  }
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.css') && entry.name !== 'tokens.css') expect(readFileSync(path, 'utf8'), path).not.toMatch(/#[\da-fA-F]{3,8}\b|rgba?\(/);
    }
  }
  visit('src/renderer/src');
});
