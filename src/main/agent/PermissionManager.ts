import { randomUUID } from 'node:crypto';
import type { FileApprovalRequest, FileChangePreview } from '../../shared/agent-file-change';
import type { PermissionDecision, PermissionEvent, PermissionRequest } from '../../shared/agent/permission';
import { ToolError, throwIfAborted } from './ToolError';
import { fileHash } from './WorkspaceService';
import { PermissionPolicy, type PermissionTarget } from './permissions/PermissionPolicy';
import type { PermissionGrantStore } from './permissions/PermissionGrantStore';

declare const approvalBrand: unique symbol;
declare const sessionBrand: unique symbol;
export interface ApprovalReceipt { readonly [approvalBrand]: true }
/** Main-only capability. A copied ID/object cannot borrow another conversation's permission. */
export interface PermissionSession { readonly id: string; readonly [sessionBrand]: true }
export type FileApprovalPrompt = (request: FileApprovalRequest, signal: AbortSignal) => Promise<'approve' | 'reject'>;
export type PermissionPrompt = (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionDecision>;
export interface PermissionManagerOptions { prompt?: PermissionPrompt; store?: PermissionGrantStore; approvalTimeoutMs?: number }
export interface PermissionCallOptions {
  /** Main-only note review: never reuse stored or session grants. */
  singleUse?: boolean;
  session?: PermissionSession;
  onEvent?: (event: PermissionEvent) => void | Promise<void>;
}
export interface FilePermissionOptions extends PermissionCallOptions { toolName?: string; workspaceIdentity?: string }
const digest = (preview: FileChangePreview) => fileHash(Buffer.from(JSON.stringify(preview)));

async function waitForWork<T>(work: Promise<T>, signal: AbortSignal, timeoutMs?: number): Promise<T> {
  let abort: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => { try { throwIfAborted(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    if (timeoutMs) timer = setTimeout(() => reject(new ToolError('TIMEOUT', '读取权限存储超时')), timeoutMs);
  });
  try { return await Promise.race([work, stopped]); }
  finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

function stable(value: unknown, depth = 0): string {
  if (depth > 24) throw new ToolError('INVALID_INPUT', '权限参数嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key], depth + 1)}`).join(',')}}`;
  }
  throw new ToolError('INVALID_INPUT', '权限参数必须为 JSON 数据');
}

export class PermissionManager {
  private readonly receipts = new WeakMap<ApprovalReceipt, { digest: string; expiresAt: number; signal: AbortSignal; revision: number }>();
  private readonly sessions = new WeakMap<PermissionSession, { grants: Set<string>; controller: AbortController }>();
  private readonly policy = new PermissionPolicy();
  private readonly options: PermissionManagerOptions;
  private readonly approvalTimeoutMs: number;
  private remembered: Set<string> | undefined;
  private storeQueue: Promise<unknown> = Promise.resolve();
  private revision = 0;

  /** The legacy diff-only prompt remains a strict allow-once adapter. */
  constructor(options?: PermissionManagerOptions | FileApprovalPrompt, timeoutMs = 5 * 60_000) {
    this.options = typeof options === 'function' ? { prompt: async (request, signal) => {
      if (!request.preview) return 'deny';
      return await options({ approvalId: request.requestId, expiresAt: request.expiresAt, preview: request.preview }, signal) === 'approve' ? 'allow_once' : 'deny';
    } } : options ?? {};
    this.approvalTimeoutMs = this.options.approvalTimeoutMs ?? timeoutMs;
    if (!Number.isInteger(this.approvalTimeoutMs) || this.approvalTimeoutMs < 1 || this.approvalTimeoutMs > 5 * 60_000) {
      throw new ToolError('INVALID_INPUT', '审批超时必须在 1–300000ms 之间');
    }
  }

  createSession(): PermissionSession {
    const session = Object.freeze({ id: randomUUID() }) as PermissionSession;
    this.sessions.set(session, { grants: new Set(), controller: new AbortController() });
    return session;
  }
  endSession(session: PermissionSession): void {
    const saved = this.sessions.get(session);
    saved?.grants.clear();
    saved?.controller.abort(new ToolError('ABORTED', '权限会话已结束'));
  }
  sessionSignal(session: PermissionSession): AbortSignal {
    const saved = this.sessions.get(session);
    if (!saved) throw new ToolError('PERMISSION_DENIED', '权限会话不属于当前 Agent');
    throwIfAborted(saved.controller.signal);
    return saved.controller.signal;
  }

  async authorize(original: PermissionTarget, parentSignal: AbortSignal, options: PermissionCallOptions = {}): Promise<void> {
    const signal = options.session ? AbortSignal.any([parentSignal, this.sessionSignal(options.session)]) : parentSignal;
    throwIfAborted(signal);
    const serialized = stable(original.input);
    if (Buffer.byteLength(serialized) > 1024 * 1024) throw new ToolError('INVALID_INPUT', '权限参数过大');
    const target = structuredClone(original);
    const assessment = this.policy.assess(target);
    if (assessment.blocked) throw new ToolError(assessment.blocked, assessment.reasons.join('；'));
    if (assessment.risk === 'SAFE' && !options.singleUse) return;
    // Grants bind to exact intent + file content versions, never a tool-name wildcard.
    const intent = target.preview ? { path: target.preview.path, operation: target.preview.operation,
      before: target.preview.beforeHash, after: target.preview.afterHash, bom: target.preview.utf8Bom } : target.input;
    const key = fileHash(Buffer.from(stable({ policy: 1, workspace: target.workspaceIdentity ?? target.workspacePath,
      tool: target.toolName, ...(target.external ? { external: target.external } : {}), risk: assessment.risk, intent })));
    const grantRevision = this.revision;
    const sessionKey = `${grantRevision}:${target.workspaceId}:${key}`;
    const session = options.session ? this.sessions.get(options.session)! : undefined;
    if (!options.singleUse && session?.grants.has(sessionKey)) return;
    if (!options.singleUse && assessment.risk !== 'DANGEROUS' && this.options.store && await waitForWork(
      this.withStore(async () => (await this.loadRemembered()).has(key)), signal, 10_000)) {
      throwIfAborted(signal);
      if (grantRevision === this.revision) return;
    }
    throwIfAborted(signal);
    if (!this.options.prompt) throw new ToolError('APPROVAL_REQUIRED', '需要用户确认，当前没有审批界面');
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    signal.addEventListener('abort', forward, { once: true });
    const expiresAt = Date.now() + this.approvalTimeoutMs;
    const timer = setTimeout(() => controller.abort(new ToolError('APPROVAL_EXPIRED', '权限确认已过期，请重新发起')), this.approvalTimeoutMs);
    const allowedDecisions: PermissionDecision[] = ['allow_once', ...(!options.singleUse && session ? ['allow_session' as const] : []),
      ...(!options.singleUse && assessment.risk !== 'DANGEROUS' && this.options.store ? ['always_allow' as const] : []), 'deny'];
    const request: PermissionRequest = { requestId: randomUUID(), toolCallId: target.toolCallId, toolName: target.toolName,
      risk: assessment.risk, reasons: assessment.reasons, workspacePath: target.workspacePath, target: assessment.target,
      scopeDescription: options.singleUse ? '仅确认本次修改，不授予后续写入权限。' : target.preview ? '仅记住此工作区、工具、文件及完全相同的修改前后内容；内容变化后重新确认。' :
        '仅记住此工作区、工具和完全相同的参数；不会授权其他操作。',
      expiresAt, allowedDecisions, preview: target.preview, command: assessment.command,
      argumentsText: target.preview ? undefined : JSON.stringify(target.input, null, 2) };
    const revision = this.revision;
    let onAbort: () => void = () => {};
    let outcome: Extract<PermissionEvent, { type: 'permission_resolved' }>['outcome'] = 'failed';
    this.emit(options, { type: 'permission_request', request });
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => { try { throwIfAborted(controller.signal); } catch (error) { reject(error); } };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      });
      const decision = await Promise.race([
        Promise.resolve().then(() => { throwIfAborted(controller.signal); return this.options.prompt!(structuredClone(request), controller.signal); }), cancelled
      ]);
      throwIfAborted(controller.signal);
      if (!allowedDecisions.includes(decision)) throw new ToolError('PERMISSION_DENIED', '当前风险级别不允许此授权方式');
      if (revision !== this.revision) throw new ToolError('APPROVAL_REQUIRED', '权限设置已变化，请重新确认');
      outcome = decision;
      if (decision === 'deny') throw new ToolError('APPROVAL_DENIED', '用户拒绝了此操作');
      if (decision === 'allow_session') {
        if (session!.grants.size >= 1000) throw new ToolError('PERMISSION_DENIED', '本次会话授权数量已达上限');
        session!.grants.add(sessionKey);
      } else if (decision === 'always_allow') {
        await waitForWork(this.withStore(async () => {
          throwIfAborted(controller.signal);
          if (revision !== this.revision) throw new ToolError('APPROVAL_REQUIRED', '权限设置已变化');
          const keys = new Set(await this.loadRemembered());
          if (keys.size >= 1000 && !keys.has(key)) throw new ToolError('PERMISSION_DENIED', '记住的权限已达上限，请先清除');
          keys.add(key);
          await this.options.store!.save([...keys]);
          // Do not retain a grant if cancellation/revocation arrived during persistence.
          if (controller.signal.aborted || revision !== this.revision) {
            await this.options.store!.save([...(this.remembered ?? [])]);
            throwIfAborted(controller.signal);
            throw new ToolError('APPROVAL_REQUIRED', '权限设置已变化');
          }
          this.remembered = keys;
        }), controller.signal);
      }
      throwIfAborted(controller.signal);
    } catch (error) {
      if (error instanceof ToolError && error.code === 'APPROVAL_EXPIRED') outcome = 'expired';
      else if (controller.signal.aborted) outcome = 'cancelled';
      else if (!(error instanceof ToolError && error.code === 'APPROVAL_DENIED')) outcome = 'failed';
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', forward);
      controller.signal.removeEventListener('abort', onAbort);
      controller.abort(new ToolError('ABORTED', '审批已结束'));
      this.emit(options, { type: 'permission_resolved', requestId: request.requestId, toolCallId: target.toolCallId, outcome });
    }
  }

  async request(preview: FileChangePreview, signal: AbortSignal, options: FilePermissionOptions = {}): Promise<ApprovalReceipt> {
    const expectedDigest = digest(preview);
    const revision = this.revision;
    await this.authorize({ toolCallId: preview.toolCallId, toolName: options.toolName ?? 'write_file',
      workspaceId: preview.workspaceId, workspacePath: preview.workspacePath, workspaceIdentity: options.workspaceIdentity,
      permission: 'workspace:write', input: { path: preview.path }, preview }, signal, options);
    const receipt = Object.freeze({}) as ApprovalReceipt;
    this.receipts.set(receipt, { digest: expectedDigest, expiresAt: Date.now() + this.approvalTimeoutMs,
      signal: options.session ? AbortSignal.any([signal, this.sessionSignal(options.session)]) : signal, revision });
    return receipt;
  }
  consume(receipt: ApprovalReceipt, preview: FileChangePreview): void {
    const saved = this.receipts.get(receipt);
    this.receipts.delete(receipt);
    if (!saved || saved.digest !== digest(preview) || saved.revision !== this.revision) throw new ToolError('APPROVAL_REQUIRED', '确认凭据与修改提案不匹配或已使用');
    throwIfAborted(saved.signal);
    if (Date.now() >= saved.expiresAt) throw new ToolError('APPROVAL_EXPIRED', '确认凭据已过期');
  }
  async clearRemembered(): Promise<void> {
    this.revision++;
    this.remembered = new Set();
    await this.withStore(async () => { this.remembered = new Set(); await this.options.store?.save([]); });
  }
  private async loadRemembered(): Promise<Set<string>> {
    if (!this.remembered) this.remembered = new Set(await this.options.store!.load());
    return this.remembered;
  }
  private withStore<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.storeQueue.then(operation);
    this.storeQueue = pending.catch(() => {});
    return pending;
  }
  private emit(options: PermissionCallOptions, event: PermissionEvent): void {
    try { void Promise.resolve(options.onEvent?.(structuredClone(event))).catch(() => {}); } catch { /* Observers cannot approve a call. */ }
  }
}
