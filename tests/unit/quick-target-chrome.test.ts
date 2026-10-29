import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ChromeTargetService, matchesWebsite, type ChromeTab, type ChromeTargetBridge } from '../../src/main/quick-target/ChromeTargetService';
import type { QuickTarget, QuickTargetPermissions } from '../../src/shared/quick-target';

const permissions: QuickTargetPermissions = { supported: true, chromeRunning: true, automation: 'granted', accessibility: true };
const tab: ChromeTab = { windowId: '1', tabId: '2', url: 'https://chatgpt.com/c/one', title: 'Synthetic conversation', index: 2 };
function fixture() {
  const target: Extract<QuickTarget, { kind: 'website' }> = { id: randomUUID(), kind: 'website', label: 'ChatGPT', url: 'https://chatgpt.com/', mode: 'existing-tab', match: 'origin', focusInput: true };
  const bridge = { permissions: vi.fn(async () => ({ ...permissions })), tabs: vi.fn(async () => [{ ...tab }]), select: vi.fn<ChromeTargetBridge['select']>(async () => ({ activated: true as const, focused: true, accessibility: true })), resolve: vi.fn<ChromeTargetBridge['resolve']>() };
  bridge.resolve.mockImplementation(async (website, signal) => {
    const status = await bridge.permissions(); signal.throwIfAborted();
    if (!status.supported || !status.chromeRunning || status.automation !== 'granted') return { kind: 'unavailable', permissions: status };
    const tabs = (await bridge.tabs()).filter(item => matchesWebsite(website.url, item.url, website.match === 'exact')); signal.throwIfAborted();
    if (tabs.length !== 1) return { kind: 'choices', permissions: status, tabs };
    const result = await bridge.select(tabs[0], website.focusInput === true && status.accessibility, signal); signal.throwIfAborted();
    return { kind: 'activated', permissions: status, focused: result.focused };
  });
  return { target, bridge, service: new ChromeTargetService(bridge), controller: new AbortController() };
}
afterEach(() => vi.useRealTimers());
it('matches parsed origins, never substrings, credentials, protocols or different conversations in exact mode', () => {
  for (const value of ['https://chatgpt.com.evil.test/', 'https://evil.test/chatgpt.com', 'http://chatgpt.com/', 'https://user:secret@chatgpt.com/', 'https://chatgpt.com:444/', 'file:///chatgpt.com']) expect(matchesWebsite('https://chatgpt.com/', value, false)).toBe(false);
  expect(matchesWebsite('https://chatgpt.com/', tab.url, false)).toBe(true);
  expect(matchesWebsite(tab.url, tab.url + '?different=1', true)).toBe(false);
  expect(matchesWebsite(tab.url, tab.url, true)).toBe(true);
});
it('switches a unique verified match and optionally focuses without opening a URL or writing the clipboard', async () => {
  const { service, bridge, target, controller } = fixture();
  expect(await service.activate(target, 4, undefined, controller.signal)).toEqual({ kind: 'done' });
  expect(bridge.select).toHaveBeenCalledWith(tab, true, controller.signal);
  expect(bridge.resolve).toHaveBeenCalledTimes(1);
});
it('requires an explicit opaque choice for multiple tabs across windows, keeping URLs and native references out of public choices', async () => {
  const { service, bridge, target, controller } = fixture();
  bridge.tabs.mockResolvedValue([tab, { ...tab, windowId: '99', tabId: '4', title: 'Another synthetic conversation' }]);
  const result = await service.activate(target, 4, undefined, controller.signal);
  if (result.kind !== 'choose') throw Error('expected choices');
  expect(result.choices).toHaveLength(2); expect(bridge.select).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/chatgpt\.com|windowId|tabId/);
  expect(result.choices[1].detail).toContain('窗口 2');
  await service.activate(target, 4, result.choices[1].id, controller.signal);
  expect(bridge.select.mock.calls[0][0]).toMatchObject({ tabId: '4' });
});
it('rejects forged, cross-presentation, cross-target, expired, changed-config and dismissed choices', async () => {
  const { service, bridge, target, controller } = fixture();
  bridge.tabs.mockResolvedValue([tab, { ...tab, tabId: '3' }]);
  const result = await service.activate(target, 4, undefined, controller.signal);
  if (result.kind !== 'choose') throw Error('expected choices');
  const id = result.choices[0].id;
  await expect(service.activate(target, 4, randomUUID(), controller.signal)).rejects.toThrow('过期');
  await expect(service.activate(target, 5, id, controller.signal)).rejects.toThrow('过期');
  await expect(service.activate({ ...target, id: randomUUID() }, 4, id, controller.signal)).rejects.toThrow('过期');
  await expect(service.activate({ ...target, match: 'exact' }, 4, id, controller.signal)).rejects.toThrow('过期');
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 60001);
  await expect(service.activate(target, 4, id, controller.signal)).rejects.toThrow('过期');
  vi.useRealTimers(); service.clear();
  await expect(service.activate(target, 4, id, controller.signal)).rejects.toThrow('过期');
  expect(bridge.select).not.toHaveBeenCalled();
});
it.each([
  { ...permissions, supported: false }, { ...permissions, chromeRunning: false },
  { ...permissions, automation: 'required' as const }, { ...permissions, automation: 'denied' as const }
])('does not enumerate or prompt when prerequisites are missing: %j', async status => {
  const { service, bridge, target, controller } = fixture(); bridge.permissions.mockResolvedValue(status);
  await expect(service.activate(target, 1, undefined, controller.signal)).rejects.toThrow();
  expect(bridge.tabs).not.toHaveBeenCalled(); expect(bridge.select).not.toHaveBeenCalled();
});
it('does not silently navigate or pick an unrelated tab when no match remains', async () => {
  const { service, bridge, target, controller } = fixture();
  bridge.tabs.mockResolvedValue([{ ...tab, url: 'https://chatgpt.com.evil.test/' }]);
  await expect(service.activate(target, 1, undefined, controller.signal)).rejects.toThrow('没有匹配'); expect(bridge.select).not.toHaveBeenCalled();
});
it('reports manual focus honestly when AX is denied or no unique composer exists', async () => {
  const { service, bridge, target, controller } = fixture();
  bridge.permissions.mockResolvedValue({ ...permissions, accessibility: false }); bridge.select.mockResolvedValue({ activated: true, focused: false, accessibility: true });
  expect(await service.activate(target, 1, undefined, controller.signal)).toMatchObject({ kind: 'manual' });
  expect(bridge.select).toHaveBeenLastCalledWith(tab, false, controller.signal);
  bridge.permissions.mockResolvedValue(permissions);
  expect(await service.activate(target, 1, undefined, controller.signal)).toMatchObject({ kind: 'manual', message: expect.stringContaining('唯一') });
  expect(await service.activate({ ...target, focusInput: false }, 1, undefined, controller.signal)).toEqual({ kind: 'done' });
});
it('cancels delayed enumeration before creating choices or activating, and propagates closed/navigated tab failure', async () => {
  const { service, bridge, target, controller } = fixture();
  bridge.tabs.mockImplementationOnce(async () => { controller.abort(); return [tab]; });
  await expect(service.activate(target, 1, undefined, controller.signal)).rejects.toThrow(); expect(bridge.select).not.toHaveBeenCalled();
  const next = new AbortController(); bridge.select.mockRejectedValueOnce(new Error('标签已关闭或跳转'));
  await expect(service.activate(target, 2, undefined, next.signal)).rejects.toThrow('跳转');
});
