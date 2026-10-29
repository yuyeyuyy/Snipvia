import { app, systemPreferences } from 'electron';
import { basename, dirname } from 'node:path';
import type { ScreenPermissionInfo } from '../../shared/contracts';

interface PlatformAdapter {
  capturePermission(): 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  permissionHelp: string;
}

const macOS: PlatformAdapter = {
  capturePermission: () => systemPreferences.getMediaAccessStatus('screen'),
  permissionHelp: `录屏权限未开启。请在录屏权限弹窗中打开系统设置并启用当前应用。${app.isPackaged ? '授权后重新打开 Snipvia.app。' : process.env.SNIPVIA_DEV_APP_PATH ? '点击“在 Finder 中选中”，把当前开发应用重新添加到录屏列表并打开开关；随后从项目终端重新运行 pnpm dev，不要直接打开 Electron.app。' : '开发版授权后请在项目终端重新运行 pnpm dev，不要单独打开 Electron.app。'}`
};

// Windows uses Electron capture APIs; no macOS TCC permission or Swift helper.
// Real-device capture and mixed-DPI acceptance remain separate release gates.
const windows: PlatformAdapter = {
  capturePermission: () => 'granted',
  permissionHelp: '无法获取屏幕，请确认当前不是安全桌面或受保护内容。'
};

export const platform = process.platform === 'darwin' ? macOS : windows;

export function screenPermissionInfo(): ScreenPermissionInfo {
  if (process.platform !== 'darwin') return {
    status: 'granted', applicationName: 'Snipvia', applicationPath: '', development: !app.isPackaged, supported: false
  };
  const configuredDevelopmentApp = !app.isPackaged ? process.env.SNIPVIA_DEV_APP_PATH : undefined;
  const executable = app.getPath('exe');
  const bundle = dirname(dirname(dirname(executable)));
  const applicationPath = configuredDevelopmentApp || (basename(bundle).endsWith('.app') ? bundle : executable);
  return {
    status: systemPreferences.getMediaAccessStatus('screen'),
    applicationName: basename(applicationPath), applicationPath,
    development: !app.isPackaged, supported: true
  };
}
