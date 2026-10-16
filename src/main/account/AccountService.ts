import { z } from 'zod';
import { predictionFailureSchema } from '../../shared/prediction-failure';
import { PredictionError } from '../analysis/PredictionError';
import { accountCodeRequestSchema, accountSignInSchema, accountUserSchema, type AccountCodeSent, type AccountState } from '../../shared/account';
import type { AccountSession, AccountSessionStore } from '../storage/account';
import { predictionServiceSchema, screenshotPredictionRequestSchema, screenshotPredictionResponseSchema } from '../../shared/prediction-protocol';
import { predictionApplicableContent, screenshotAnalysisSchema, type PredictionBranch, type ScreenshotAnalysis } from '../../shared/screenshot-understanding';
import { ScreenshotChatAccessError, screenshotChatAccessError } from '../../shared/screenshot-chat-access';

const configSchema = z.object({ registrationOpen: z.boolean(), development: z.boolean(), authOrigin: z.string().optional() });
const meSchema = z.object({ user: accountUserSchema });
const sessionSchema = z.object({ session: z.object({ expiresAt: z.coerce.date() }) }).nullable();
const cookiePattern = /^(?:__Secure-)?better-auth\.session_token=[^;\s]+$/;
const loopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const defaultAccountOrigin = 'https://console.umbraticus.cn';
export function accountOrigin(value: string | undefined, packaged: boolean): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !packaged && loopback(url))) return null;
    return url.origin;
  } catch { return null; }
}

export function resolveAccountOrigin(packaged: boolean, buildOrigin?: string, developmentOrigin?: string): string | null {
  const value = (!packaged && developmentOrigin) || buildOrigin || defaultAccountOrigin;
  return accountOrigin(value, packaged);
}

class AccountRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class AccountService {
  private session: AccountSession | null = null;
  private state: AccountState;
  private development = false;
  private requestOrigin: string | null = null;
  private retryAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private accessRevision = 0;
  private readonly predictionControllers = new Set<AbortController>();
  constructor(private readonly options: {
    origin: string | null; packaged: boolean; store: AccountSessionStore;
    fetch?: typeof fetch; now?: () => number; onChanged?: (state: AccountState) => void;
  }) {
    this.session = options.origin ? options.store.load(options.origin, this.now()) : null;
    this.state = {
      configured: Boolean(options.origin), connection: options.origin ? 'unavailable' : 'unconfigured',
      registrationOpen: null, user: null, sessionPresent: Boolean(this.session), remembered: Boolean(this.session), error: null
    };
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(action);
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private publish() { this.options.onChanged?.(structuredClone(this.state)); return structuredClone(this.state); }
  private forget() {
    this.accessRevision++;
    for (const controller of this.predictionControllers) controller.abort(new Error('账号已退出，预测已取消'));
    this.session = null;
    this.state.user = null; this.state.sessionPresent = false; this.state.remembered = false;
    this.options.store.clear();
  }
  private persist() {
    if (!this.session) return;
    try { this.state.remembered = this.options.store.save(this.session); }
    catch { this.state.remembered = false; this.options.store.clear(); }
  }

  private async request(path: string, body?: unknown, authenticated = false, options: { signal?: AbortSignal; timeoutMs?: number; responseLimit?: number; updateSession?: boolean } = {}): Promise<unknown> {
    if (!this.options.origin) throw new Error('账号服务暂未配置，请联系应用提供方');
    const headers = new Headers({ Origin: this.requestOrigin ?? this.options.origin, Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (authenticated && this.session) headers.set('Cookie', this.session.cookie);
    let response: Response;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const limit = options.responseLimit ?? 65536;
    try {
      response = await (this.options.fetch ?? fetch)(`${this.options.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal
      });
    } catch { if (options.signal?.aborted) throw options.signal.reason; if (path === '/api/predictions/screenshot') throw new PredictionError({ stage: 'service', reason: timeout.aborted ? 'timeout' : 'network' }); throw new Error('暂时无法连接账号服务，请检查网络后重试'); }
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('账号服务响应异常'); }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > limit) { await reader.cancel(); throw new Error('账号服务响应异常'); }
        chunks.push(chunk.value);
      }
    } catch { if (options.signal?.aborted) throw options.signal.reason; throw new Error('账号服务响应异常或连接中断，请重试'); }
    finally { reader.releaseLock(); }
    let data: unknown;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('账号服务响应异常，请稍后重试'); }
    if (!response.ok) {
      if (path === '/api/predictions/screenshot' && (response.status >= 500 || response.status === 429)) {
        const failure = predictionFailureSchema.safeParse(data && typeof data === 'object' && 'prediction' in data ? data.prediction : undefined);
        throw new PredictionError(failure.success ? failure.data : { stage: 'service', reason: response.status === 429 ? 'busy' : response.status === 504 ? 'timeout' : 'unavailable' });
      }
      if (response.status === 403 && data && typeof data === 'object' && 'code' in data && data.code === 'MEMBERSHIP_REQUIRED') {
        throw new ScreenshotChatAccessError('截图对话需要有效的会员资格，请联系管理员开通。普通截图仍可使用。');
      }
      // Do not relay arbitrary server errors, which could contain credentials or internal details.
      const message = response.status === 429 ? '操作过于频繁，请稍后再试' :
        path.includes('sign-in') ? '验证码无效、已过期或账号不可用，请重新获取验证码' :
        response.status === 401 || response.status === 403 ? '登录已失效或账号不可用，请重新登录' : '账号服务暂时无法完成操作，请稍后再试';
      throw new AccountRequestError(message, response.status);
    }
    if (options.updateSession !== false && (path === '/api/auth/sign-in/email-otp' || authenticated)) {
      for (const setCookie of response.headers.getSetCookie()) {
        const cookie = setCookie.split(';')[0];
        if (cookiePattern.test(cookie)) this.session = { origin: this.options.origin, cookie, expiresAt: this.now() + 7 * 86400_000 };
      }
    }
    return data;
  }

  private async configuration() {
    const config = configSchema.parse(await this.request('/api/config'));
    const canonical = accountOrigin(config.authOrigin ?? this.options.origin!, this.options.packaged);
    if (!canonical) throw new Error('账号服务配置异常');
    // Development web UI and API may use different ports. Only this header changes;
    // all requests and private cookies remain bound to the configured API origin.
    this.requestOrigin = canonical;
    this.development = config.development && !this.options.packaged && loopback(new URL(this.options.origin!));
    this.state.registrationOpen = config.registrationOpen;
    return config;
  }

  private async refresh(): Promise<AccountState> {
    if (!this.options.origin) return this.publish();
    try {
      await this.configuration();
      if (this.session) {
        if (this.session.expiresAt <= this.now()) this.forget();
        else {
          const identity = sessionSchema.parse(await this.request('/api/auth/get-session', undefined, true));
          if (!identity) { this.forget(); this.state.error = '登录已失效，请重新登录'; }
          else {
            this.session.expiresAt = identity.session.expiresAt.getTime();
            const me = meSchema.parse(await this.request('/api/me', undefined, true));
            if (me.user.status !== 'active') { this.forget(); this.state.error = '账号不可用，请联系管理员'; }
            else { this.state.user = me.user; this.state.sessionPresent = true; this.state.error = null; this.persist(); }
          }
        }
      } else this.state.error = null;
      this.state.connection = 'connected';
    } catch (error) {
      if (error instanceof AccountRequestError && [401, 403].includes(error.status)) {
        this.forget(); this.state.connection = 'connected';
      } else this.state.connection = 'unavailable';
      this.state.error = error instanceof z.ZodError ? '账号服务响应异常，请稍后重试' : error instanceof Error ? error.message : '账号服务暂不可用';
    }
    return this.publish();
  }

  get() { return this.serial(() => this.refresh()); }
  /** Local UI hint only. AI entry points must still call requireScreenshotChatAccess. */
  screenshotCaptureNotice(): string | null {
    const state = this.session && this.session.expiresAt > this.now()
      ? this.state : { ...this.state, user: null, sessionPresent: false };
    return screenshotChatAccessError(state, this.now());
  }
  async requireScreenshotChatAccess(): Promise<void> {
    const revision = this.accessRevision;
    // Anonymous capture remains local and does not wait for an account server.
    const state = this.session ? await this.get() : { ...this.state, user: null, sessionPresent: false };
    const error = screenshotChatAccessError(state, this.now());
    if (error) throw new ScreenshotChatAccessError(error);
    if (revision !== this.accessRevision || !this.session || this.session.expiresAt <= this.now()) {
      throw new ScreenshotChatAccessError('登录状态已变化，请重新登录后使用截图对话；如无会员资格，请联系管理员。普通截图仍可使用。');
    }
  }
  async predictScreenshot(image: string, branches: PredictionBranch[], signal: AbortSignal): Promise<ScreenshotAnalysis | null> {
    if (signal.aborted) throw signal.reason;
    if (!this.session || !this.options.origin || !branches.some(branch => branch.enabled)) return null;
    if (this.session.expiresAt <= this.now()) { this.forget(); this.publish(); return null; }
    const controller = new AbortController(); this.predictionControllers.add(controller);
    const active = AbortSignal.any([signal, controller.signal]);
    try {
      if (!this.requestOrigin) await this.configuration();
      let service: ReturnType<typeof predictionServiceSchema.parse>;
      try { service = predictionServiceSchema.parse(await this.request('/api/me/prediction-service', undefined, true, { signal: active, updateSession: false })); }
      catch (error) { if (error instanceof AccountRequestError && error.status === 404) return null; throw error; }
      if (!service.provider) return null;
      const enabled = branches.filter(branch => branch.enabled);
      const input = screenshotPredictionRequestSchema.parse({ image, branches: enabled.map(branch => ({ id: branch.id, applicableContent: predictionApplicableContent(branch) })) });
      const output = screenshotPredictionResponseSchema.parse(await this.request('/api/predictions/screenshot', input, true, { signal: active, timeoutMs: service.timeoutMs + 5000, responseLimit: 131072, updateSession: false }));
      if (active.aborted) throw active.reason;
      if (output.matchedBranchId !== null && !enabled.some(branch => branch.id === output.matchedBranchId)) throw new Error('预测返回了未启用的分支');
      return screenshotAnalysisSchema.parse(output);
    } catch (error) {
      if (error instanceof AccountRequestError && [401, 403].includes(error.status)) { this.forget(); this.publish(); }
      throw error;
    } finally { this.predictionControllers.delete(controller); }
  }
  sendCode(value: unknown): Promise<AccountCodeSent> {
    const { email } = accountCodeRequestSchema.parse(value);
    return this.serial(async () => {
      if (this.now() < this.retryAt) throw new Error('请等待一分钟后再获取验证码');
      await this.configuration();
      await this.request('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
      this.retryAt = this.now() + 60_000;
      let developmentCode: string | null = null;
      if (this.development) try {
        developmentCode = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await this.request(`/api/dev/mail?email=${encodeURIComponent(email)}`)).code;
      } catch { /* Normal mail flow does not depend on the development mailbox. */ }
      this.state.connection = 'connected'; this.state.error = null; this.publish();
      return { retryAt: this.retryAt, developmentCode };
    });
  }
  signIn(value: unknown) {
    const input = accountSignInSchema.parse(value);
    this.accessRevision++;
    return this.serial(async () => {
      await this.configuration();
      const previous = this.session;
      this.session = null;
      try { await this.request('/api/auth/sign-in/email-otp', input); }
      catch (error) { this.session = previous; throw error; }
      if (!this.session) throw new Error('账号服务未返回有效的登录会话');
      const state = await this.refresh();
      if (!state.user) throw new Error(state.error ?? '登录未完成，请重试');
      return state;
    });
  }
  signOut() {
    this.accessRevision++;
    for (const controller of this.predictionControllers) controller.abort(new Error('账号已退出，预测已取消'));
    return this.serial(async () => {
      let remoteSignedOut = true;
      try { if (this.session) await this.request('/api/auth/sign-out', {}, true); }
      catch { remoteSignedOut = false; }
      finally { this.forget(); this.state.error = null; this.publish(); }
      return { remoteSignedOut };
    });
  }
}
