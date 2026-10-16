import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoStartArgument, getLoginItemState, launchedAtLogin, setLoginItem } from '../../src/main/platform/login-item';

const runtime = vi.hoisted(() => ({
  packaged: true, openAtLogin: false, enabled: false, acceptsChanges: true,
  get: vi.fn(), set: vi.fn()
}));
vi.mock('electron', () => ({ app: {
  get isPackaged() { return runtime.packaged; },
  getLoginItemSettings: runtime.get,
  setLoginItemSettings: runtime.set
} }));

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(runtime, { packaged: true, openAtLogin: false, enabled: false, acceptsChanges: true });
  runtime.get.mockImplementation(() => ({
    openAtLogin: runtime.openAtLogin,
    launchItems: [{ name: 'Snipvia', enabled: runtime.enabled }],
    wasOpenedAtLogin: false
  }));
  runtime.set.mockImplementation((value: { openAtLogin: boolean; enabled: boolean }) => {
    if (runtime.acceptsChanges) Object.assign(runtime, { openAtLogin: value.openAtLogin, enabled: value.enabled });
  });
});

describe('launch at login', () => {
  it('registers the Windows executable with matching arguments and removes the entry when disabled', () => {
    expect(setLoginItem(true, 'win32').enabled).toBe(true);
    const options = { path: process.execPath, args: [autoStartArgument] };
    expect(runtime.set).toHaveBeenLastCalledWith({ ...options, name: 'Snipvia', enabled: true, openAtLogin: true });
    expect(runtime.get).toHaveBeenLastCalledWith(options);
    expect(setLoginItem(false, 'win32').enabled).toBe(false);
    expect(runtime.set).toHaveBeenLastCalledWith({ ...options, name: 'Snipvia', enabled: false, openAtLogin: false });
  });

  it('reflects a Windows entry disabled in Task Manager instead of a saved preference', () => {
    runtime.openAtLogin = true;
    expect(getLoginItemState('win32').enabled).toBe(false);
    runtime.enabled = true;
    expect(getLoginItemState('win32').enabled).toBe(true);
  });

  it('reports OS registration failure without claiming it was enabled', () => {
    runtime.acceptsChanges = false;
    expect(() => setLoginItem(true, 'win32')).toThrow('未生效');
    expect(getLoginItemState('win32').enabled).toBe(false);
  });

  it('does not register an Electron development binary or unsupported platform', () => {
    runtime.packaged = false;
    expect(getLoginItemState('win32').supported).toBe(false);
    expect(() => setLoginItem(true, 'win32')).toThrow('打包');
    runtime.packaged = true;
    expect(getLoginItemState('linux').supported).toBe(false);
    expect(runtime.set).not.toHaveBeenCalled();
  });

  it('starts hidden only for an OS login launch, preserving normal manual launch', () => {
    expect(launchedAtLogin('win32', ['Snipvia.exe', autoStartArgument])).toBe(true);
    expect(launchedAtLogin('win32', ['Snipvia.exe'])).toBe(false);
    runtime.packaged = false;
    expect(launchedAtLogin('win32', ['electron', autoStartArgument])).toBe(false);
    runtime.packaged = true;
    runtime.get.mockReturnValue({ wasOpenedAtLogin: true });
    expect(launchedAtLogin('darwin')).toBe(true);
    runtime.get.mockImplementation(() => { throw new Error('OS unavailable'); });
    expect(launchedAtLogin('darwin')).toBe(false);
  });
});
