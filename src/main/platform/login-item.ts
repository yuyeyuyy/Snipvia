import { app } from 'electron';
import type { LoginItemState } from '../../shared/contracts';

const loginItemName = 'Snipvia';
export const autoStartArgument = '--snipvia-autostart';

function loginOptions(platform: NodeJS.Platform) {
  return platform === 'win32' ? { path: process.execPath, args: [autoStartArgument] } : {};
}

export function getLoginItemState(platform: NodeJS.Platform = process.platform): LoginItemState {
  if (!['win32', 'darwin'].includes(platform)) {
    return { supported: false, enabled: false, description: '当前系统暂不支持开机自启' };
  }
  if (!app.isPackaged) {
    return { supported: false, enabled: false, description: '请使用打包后的截然设置开机自启' };
  }
  const state = app.getLoginItemSettings(loginOptions(platform));
  const enabled = state.openAtLogin && (platform !== 'win32'
    || state.launchItems.some((item) => item.name === loginItemName && item.enabled));
  return {
    supported: true,
    enabled,
    description: platform === 'win32'
      ? '登录 Windows 后在托盘运行；移动应用文件夹后请重新开启'
      : state.status === 'requires-approval' ? '请在系统设置的“登录项”中允许截然启动' : '登录 Mac 后在菜单栏运行'
  };
}

export function setLoginItem(enabled: boolean, platform: NodeJS.Platform = process.platform): LoginItemState {
  const previous = getLoginItemState(platform);
  if (!previous.supported) throw new Error(previous.description);
  app.setLoginItemSettings({
    openAtLogin: enabled,
    ...loginOptions(platform),
    ...(platform === 'win32' ? { name: loginItemName, enabled } : {})
  });
  const current = getLoginItemState(platform);
  if (current.enabled !== enabled) {
    throw new Error(platform === 'win32'
      ? '开机自启未生效，请检查 Windows 设置 → 应用 → 启动中的截然状态'
      : '开机自启未生效，请在系统设置 → 通用 → 登录项中确认截然状态');
  }
  return current;
}

export function launchedAtLogin(platform: NodeJS.Platform = process.platform, argv = process.argv): boolean {
  if (!app.isPackaged) return false;
  if (platform === 'win32') return argv.includes(autoStartArgument);
  try { return platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin; }
  catch { return false; }
}
