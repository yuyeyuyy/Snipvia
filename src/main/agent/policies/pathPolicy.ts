import path from 'node:path';
import { ToolError } from '../ToolError';

export function workspaceRelativePath(input: string): string {
  if (!input || input.length > 4096 || [...input].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || input.includes('\\') ||
      path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    throw new ToolError('PATH_OUTSIDE_WORKSPACE', '请使用 workspace 内的相对路径');
  }
  const segments = input.split('/').filter((part) => part !== '.' && part !== '');
  if (segments.some((part) => part === '..' || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) ||
    /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part))) {
    throw new ToolError('PATH_OUTSIDE_WORKSPACE', '路径包含越界或不支持的路径片段');
  }
  return segments.join('/') || '.';
}

export function isInsideWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
