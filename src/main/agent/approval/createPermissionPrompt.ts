import { BrowserWindow, nativeTheme, type IpcMainInvokeEvent, type WebPreferences } from 'electron';
import tokens from '../../../shared/design-tokens.json';
import { z } from 'zod';
import { throwIfAborted } from '../ToolError';
import type { PermissionPrompt } from '../PermissionManager';
import type { PermissionDecision } from '../../../shared/agent/permission';

const decisionSchema = z.strictObject({ requestId: z.string().uuid(), decision: z.enum(['allow_once', 'allow_session', 'always_allow', 'deny']) });

/** No global responder: a decision belongs to the exact window AND its original main frame. */
export function createPermissionPrompt(options: {
  webPreferences: WebPreferences;
  parent(): BrowserWindow | undefined;
  load(window: BrowserWindow): Promise<unknown>;
  clearRemembered(): Promise<void>;
}): PermissionPrompt {
  return async (request, signal) => {
    throwIfAborted(signal);
    const parent = options.parent();
    const window = new BrowserWindow({
      width: 980, height: 800, minWidth: 640, minHeight: 540, show: false,
      title: 'Agent 权限确认 · 截然', backgroundColor: tokens[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']['bg-window'],
      parent: parent?.isDestroyed() ? undefined : parent,
      webPreferences: { ...options.webPreferences, sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    const contents = window.webContents;
    let settled = false;
    const allowed = (event: IpcMainInvokeEvent) => !settled && !signal.aborted && Date.now() < request.expiresAt &&
      event.sender === contents && event.senderFrame === contents.mainFrame;
    let resolve: (decision: PermissionDecision) => void = () => {};
    const decide = (decision: PermissionDecision) => { if (!settled) { settled = true; resolve(decision); } };
    const aborted = () => decide('deny');
    try {
      const answer = new Promise<PermissionDecision>((done) => { resolve = done; });
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      contents.ipc.handle('agent:permission:current', (event) => {
        if (!allowed(event)) throw new Error('Permission denied');
        return structuredClone(request);
      });
      contents.ipc.handle('agent:permission:decide', (event, value: unknown) => {
        const parsed = decisionSchema.safeParse(value);
        if (!allowed(event) || !parsed.success || parsed.data.requestId !== request.requestId ||
            !request.allowedDecisions.includes(parsed.data.decision) || (request.risk === 'DANGEROUS' && parsed.data.decision === 'always_allow')) {
          throw new Error('确认请求无效、决策不允许或请求已过期');
        }
        decide(parsed.data.decision);
      });
      contents.ipc.handle('agent:permission:clear', async (event) => {
        if (!allowed(event)) throw new Error('Permission denied');
        await options.clearRemembered();
        decide('deny'); // The pending request also needs fresh authorization after settings change.
      });
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', (event) => event.preventDefault());
      contents.on('will-frame-navigate', (event) => event.preventDefault());
      contents.once('render-process-gone', () => decide('deny'));
      contents.once('did-fail-load', () => decide('deny'));
      window.once('closed', () => decide('deny'));
      contents.once('did-finish-load', () => {
        if (!settled && !signal.aborted) contents.send('agent:permission:request', structuredClone(request));
      });
      void options.load(window).then(() => {
        if (!window.isDestroyed() && !settled && !signal.aborted) window.show();
      }).catch(() => decide('deny'));
      const result = await answer;
      throwIfAborted(signal);
      return result;
    } finally {
      signal.removeEventListener('abort', aborted);
      if (!contents.isDestroyed()) {
        for (const channel of ['current', 'decide', 'clear']) contents.ipc.removeHandler(`agent:permission:${channel}`);
      }
      if (!window.isDestroyed()) window.destroy();
    }
  };
}
