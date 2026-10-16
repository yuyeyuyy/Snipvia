import type { ToolErrorCode, ToolResult } from './types/tool';

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string, readonly details?: { bytesRead: number }) {
    super(message);
    this.name = 'ToolError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof ToolError ? signal.reason : new ToolError('ABORTED', '工具调用已取消');
  }
}

export function normalizeToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'ENOENT': return new ToolError('NOT_FOUND', '文件或目录不存在');
    case 'EACCES': case 'EPERM': return new ToolError('PERMISSION_DENIED', '无法访问文件或目录');
    case 'ENOTDIR': return new ToolError('NOT_A_DIRECTORY', '目标不是目录');
    case 'EISDIR': return new ToolError('NOT_A_FILE', '目标不是普通文件');
    case 'ELOOP': return new ToolError('SYMLINK_NOT_ALLOWED', '不允许通过符号链接访问文件');
    case 'EIO': case 'EMFILE': case 'ENFILE': return new ToolError('IO_ERROR', '文件系统读取失败');
    case 'ABORT_ERR': return new ToolError('ABORTED', '工具调用已取消');
    default: return new ToolError('INTERNAL_ERROR', '工具执行失败');
  }
}

export function toolFailure(error: unknown): ToolResult<never> {
  const normalized = normalizeToolError(error);
  // Do not forward native error messages: they can expose absolute paths or credentials.
  return { success: false, error: { code: normalized.code, message: normalized.message } };
}
