import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
const runtime = vi.hoisted(() => ({ area: { x: -1440, y: 30, width: 1440, height: 900 }, cursor: { x: -3000, y: -3000 } }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { screen: { getCursorScreenPoint: () => runtime.cursor, getDisplayNearestPoint: () => ({ workArea: runtime.area }), getDisplayMatching: () => ({ workArea: runtime.area }) },
    BrowserWindow: class extends EventEmitter {
      bounds: Rectangle; visible = false; focused = false; destroyed = false;
      webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
      constructor(options: Record<string, unknown>) { super(); this.bounds = { x: Number(options.x), y: Number(options.y), width: Number(options.width), height: Number(options.height) }; }
      getBounds() { return { ...this.bounds }; } setBounds = vi.fn((value: Rectangle) => { this.bounds = { ...value }; });
      isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isFocused() { return this.focused; }
      show() { this.visible = true; } showInactive() { this.visible = true; } focus() { this.focused = true; }
      hide() { this.visible = false; } blur() { this.focused = false; } destroy() { this.destroyed = true; }
      setOpacity = vi.fn(); setIgnoreMouseEvents = vi.fn(); setFocusable = vi.fn(); setVisibleOnAllWorkspaces = vi.fn();
    }
  };
});
vi.mock('../../src/main/performance/screenshot-performance', () => ({ screenshotPerformance: { startSession: () => 'synthetic', mark: vi.fn(), updateMetadata: vi.fn() } }));
import { ShelfWindow } from '../../src/main/windows/ShelfWindow';
import { defaultShelfPreferences } from '../../src/shared/shelf-preferences';
import type { ScreenshotItem } from '../../src/shared/screenshot';
import { shelfWindowBounds, shelfDockBounds } from '../../src/shared/collection';
const windows: ShelfWindow[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }); });
afterEach(() => { windows.splice(0).forEach(window => window.destroy()); vi.useRealTimers(); runtime.cursor = { x: -3000, y: -3000 }; });
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
async function fixture() {
  const items: ScreenshotItem[] = Array.from({ length: 6 }, () => ({ id: randomUUID(), createdAt: new Date().toISOString(), width: 600, height: 380, mimeType: 'image/png', status: 'temporary' }));
  const shelf = new ShelfWindow({}, async () => { shelf.markReady(); }, () => ({ id: 'synthetic', createdAt: 1, updatedAt: 1, revision: 1, items, count: items.length }), () => 'data:image/png;base64,synthetic');
  windows.push(shelf); await shelf.toggle(); shelf.rendered(shelf.current().presentation);
  return { shelf, items, native: shelf.peekWindow()! };
}
it('docks only after leaving idle, restores from the edge and rejects late motion ACKs', async () => {
  const { shelf, native } = await fixture(), shown = native.getBounds();
  vi.advanceTimersByTime(1840);
  expect(shelf.current().edge).toBe('docking');
  const p = shelf.current().presentation;
  expect(shelf.edgeFinished(p - 1)).toBe(false);
  expect(shelf.edgeFinished(p)).toBe(true); await settle(); shelf.rendered(shelf.current().presentation);
  expect(shelf.current().edge).toBe('docked');
  expect(native.getBounds().width).toBe(22);
  expect(native.getBounds().x + 22).toBe(runtime.area.x + runtime.area.width);
  await shelf.reveal(); shelf.rendered(shelf.current().presentation);
  expect(shelf.current().edge).toBe('revealing');
  shelf.edgeFinished(shelf.current().presentation);
  expect(shelf.current().edge).toBe('shown'); expect(native.getBounds()).toEqual(shown);
});
it('anchors the edge handle to the stack for both expanded and collapsed panels', async () => {
  const { shelf, native, items } = await fixture();
  const stack = shelfWindowBounds(runtime.area, shelf.current().size, items, false);
  const expected = shelfDockBounds(runtime.area, stack);
  expect(native.getBounds().height).toBeGreaterThan(stack.height);
  vi.advanceTimersByTime(1840); shelf.edgeFinished(shelf.current().presentation); await settle(); shelf.rendered(shelf.current().presentation);
  expect(native.getBounds()).toEqual(expected);
  await shelf.reveal(); shelf.rendered(shelf.current().presentation); shelf.edgeFinished(shelf.current().presentation);
  shelf.collapse(); await settle(); shelf.rendered(shelf.current().presentation);
  vi.advanceTimersByTime(1840); shelf.edgeFinished(shelf.current().presentation); await settle(); shelf.rendered(shelf.current().presentation);
  expect(native.getBounds()).toEqual(expected);
  await shelf.configure({ ...defaultShelfPreferences, heightMode: 'fixed', height: 1600 });
  expect(native.getBounds()).toEqual(expected);
});
it('holds the panel during a tool interaction and cancels edge motion before a new capture', async () => {
  const { shelf, native, items } = await fixture();
  shelf.setPointerInteraction(true); vi.advanceTimersByTime(3000); expect(shelf.current().edge).toBe('shown');
  shelf.setPointerInteraction(false); vi.advanceTimersByTime(1840); expect(shelf.current().edge).toBe('docking');
  const p = shelf.current().presentation; shelf.suspend();
  expect(shelf.edgeFinished(p)).toBe(false); expect(shelf.rendered(p)).toBe(false);
  expect(native.setOpacity).toHaveBeenLastCalledWith(0); expect(native.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  expect(shelf.current().collection.items).toEqual(items);
});
it('uses the same window for centered preview and restores the previous panel on close', async () => {
  const { shelf, native, items } = await fixture(), previous = native.getBounds();
  await shelf.openPreview(items[0].id, { x: 16, y: 60, width: 300, height: 190 });
  expect(native.getBounds()).toEqual(runtime.area);
  const preview = shelf.current().preview!;
  expect(preview.target.x + preview.target.width / 2).toBe(runtime.area.width / 2);
  expect(preview.target.y + preview.target.height / 2).toBe(runtime.area.height / 2);
  shelf.rendered(shelf.current().presentation); const opening = shelf.current().presentation;
  shelf.closePreview();
  expect(shelf.previewFinished(opening)).toBe(false);
  expect(shelf.previewFinished(shelf.current().presentation)).toBe(true); await settle();
  expect(shelf.current().preview).toBeUndefined(); expect(native.getBounds()).toEqual(previous);
  expect(shelf.current().collection.items).toEqual(items);
});
it('does not reveal a stale fullscreen preview or clear images after capture cancellation', async () => {
  const { shelf, native, items } = await fixture();
  await expect(shelf.openPreview(items[0].id, { x: NaN, y: 60, width: 300, height: 190 })).rejects.toThrow();
  await shelf.openPreview(items[0].id, { x: 16, y: 60, width: 300, height: 190 });
  const p = shelf.current().presentation; shelf.suspend();
  expect(shelf.rendered(p)).toBe(false); expect(shelf.current().preview).toBeUndefined();
  expect(native.setOpacity).toHaveBeenLastCalledWith(0); expect(shelf.current().collection.count).toBe(6);
});
it('honors disabled auto-hide and preserves the base dimensions when toggling width', async () => {
  const { shelf, native } = await fixture();
  await shelf.configure({ ...defaultShelfPreferences, autoHide: false }); shelf.rendered(shelf.current().presentation);
  vi.advanceTimersByTime(5000); expect(shelf.current().edge).toBe('shown');
  const original = shelf.current().size; await shelf.widen();
  expect(native.getBounds().width).toBeGreaterThan(original.width); expect(shelf.current().size).toEqual(original);
  await shelf.widen(); expect(native.getBounds().width).toBe(original.width);
});

it('disabling auto-hide while capture is suspended also disables a previously docked state', async () => {
  const { shelf } = await fixture();
  vi.advanceTimersByTime(1840); shelf.edgeFinished(shelf.current().presentation); await settle();
  shelf.suspend(); await shelf.configure({ ...defaultShelfPreferences, autoHide: false });
  expect(shelf.current().edge).toBe('shown'); expect(shelf.current().suspended).toBe(true);
  shelf.resume(); await settle(); shelf.rendered(shelf.current().presentation);
  vi.advanceTimersByTime(5000); expect(shelf.current().edge).toBe('shown');
});

it('opens a screen-relative viewport and applies a custom height without requiring more photos', async () => {
  const { shelf, native, items } = await fixture(); items.splice(1);
  await shelf.configure({ ...defaultShelfPreferences, autoHide: false });
  expect(shelf.current().expanded).toBe(true); expect(native.getBounds().height).toBe(675);
  await shelf.configure({ ...defaultShelfPreferences, heightMode: 'fixed', height: 780, autoHide: false });
  expect(native.getBounds().height).toBe(780);
  expect(shelf.current().collection.count).toBe(1);
});

it('treats an unfocused edge handle and reveal as Shelf interaction, without suppressing unrelated activation', async () => {
  const { shelf, native } = await fixture();
  vi.advanceTimersByTime(1840); shelf.edgeFinished(shelf.current().presentation); await settle(); shelf.rendered(shelf.current().presentation);
  const dock = native.getBounds(); native.blur();
  runtime.cursor = { x: dock.x + 10, y: dock.y + 40 };
  expect(shelf.hasPointerInteraction()).toBe(true);
  runtime.cursor = { x: -3000, y: -3000 }; expect(shelf.hasPointerInteraction()).toBe(false);
  await shelf.reveal(); expect(shelf.hasPointerInteraction()).toBe(true);
  const p = shelf.current().presentation;
  await shelf.reveal(); expect(shelf.current().presentation).toBe(p);
  shelf.rendered(p); shelf.edgeFinished(p); expect(shelf.hasPointerInteraction()).toBe(false);
});
it('reveals on edge hover without focus, a click or a rendered hit region', async () => {
  const { shelf, native } = await fixture();
  vi.advanceTimersByTime(1840); shelf.edgeFinished(shelf.current().presentation); await settle(); shelf.rendered(shelf.current().presentation);
  native.blur(); const dock = native.getBounds();
  runtime.cursor = { x: dock.x + 10, y: dock.y + 40 };
  vi.advanceTimersByTime(32); await settle();
  expect(shelf.current().edge).toBe('revealing'); expect(native.getBounds().width).toBe(420);
});
