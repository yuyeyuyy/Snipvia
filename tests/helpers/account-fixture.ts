import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AccountUser } from '../../src/shared/account';

// Synthetic desktop HTTP contract fixture. It has no production authentication,
// database, mail delivery, administrative API or external network dependency.
// The real server's security and business tests live in the private workspace.
export function createAccountFixture(options: { predictionFetch?: typeof fetch } = {}) {
  const users = new Map<string, AccountUser>();
  const sessions = new Map<string, string>();
  const grants = new Map<string, string>();
  const codes = new Map<string, string>();
  const usage = new Map<string, { requested: number; succeeded: number }>();
  let predictionEnabled = false;
  const store = {
    byEmail: (email: string) => [...users.values()].find(user => user.email === email),
    issue(userId: string, _input: unknown, _actor: unknown) {
      void _input; void _actor;
      const id = randomUUID(); grants.set(id, userId);
      users.get(userId)!.access = { state: 'permanent', expiresAt: null };
      return { id };
    },
    changeGrant(id: string, _input: unknown, _actor: unknown) {
      void _input; void _actor;
      users.get(grants.get(id)!)!.access = { state: 'none', expiresAt: null };
    },
    updateUser(id: string, input: { status: AccountUser['status']; reason: string }, _actor: unknown) {
      void _actor;
      users.get(id)!.status = input.status;
      if (input.status !== 'active') for (const [cookie, userId] of sessions) if (userId === id) sessions.delete(cookie);
    },
    predictionUsage: (id: string) => usage.get(id) ?? { requested: 0, succeeded: 0 },
    sessionCount: () => sessions.size
  };
  async function inject(input: { method: string; url: string; headers?: Record<string, string | string[] | undefined>; payload?: unknown }) {
    const url = new URL(input.url, 'http://127.0.0.1');
    const payload = typeof input.payload === 'string' ? JSON.parse(input.payload) : input.payload;
    const cookie = String(input.headers?.cookie ?? '').split(';')[0];
    const user = users.get(sessions.get(cookie) ?? '');
    let statusCode = 200;
    let data: unknown;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (url.pathname === '/api/config') data = { registrationOpen: true, development: true, authOrigin: 'http://localhost:5174' };
    else if (url.pathname === '/api/auth/email-otp/send-verification-otp') {
      codes.set(payload.email, '123456'); data = { success: true };
    } else if (url.pathname === '/api/dev/mail') data = { code: codes.get(url.searchParams.get('email')!) };
    else if (url.pathname === '/api/auth/sign-in/email-otp') {
      if (codes.get(payload.email) !== payload.otp) { statusCode = 401; data = {}; }
      else {
        codes.delete(payload.email);
        let identity = store.byEmail(payload.email);
        if (!identity) {
          identity = { id: randomUUID(), email: payload.email, emailVerified: true, role: 'user', status: 'active', access: { state: 'none', expiresAt: null } };
          users.set(identity.id, identity);
        }
        const token = `better-auth.session_token=synthetic-${randomUUID()}.fixture`;
        sessions.set(token, identity.id); headers['set-cookie'] = `${token}; HttpOnly; SameSite=Lax; Path=/`; data = { success: true };
      }
    } else if (url.pathname === '/api/auth/sign-out') { sessions.delete(cookie); data = { success: true }; }
    else if (url.pathname === '/api/auth/get-session') data = user?.status === 'active' ? { session: { expiresAt: new Date(Date.now() + 86400_000).toISOString() } } : null;
    else if (!user || user.status !== 'active') { statusCode = 401; data = {}; }
    else if (url.pathname === '/api/me') data = { user };
    else if (url.pathname === '/api/me/prediction-service') data = predictionEnabled ? { provider: 'typesafe', model: 'jev-1.13.0', input: 'image', timeoutMs: 3000 } : { provider: null };
    else if (url.pathname === '/api/predictions/screenshot' && predictionEnabled && options.predictionFetch) {
      const count = usage.get(user.id) ?? { requested: 0, succeeded: 0 }; count.requested++; usage.set(user.id, count);
      // Only the caller-supplied mock is invoked, with a loopback sentinel URL.
      const upstream = await options.predictionFetch('http://127.0.0.1/synthetic/chat/completions');
      statusCode = 502;
      data = { prediction: { stage: 'vision', reason: 'auth', upstreamStatus: upstream.status } };
    } else { statusCode = 404; data = {}; }
    const body = JSON.stringify(data);
    return { statusCode, headers, body };
  }
  const http = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await inject({ method: request.method!, url: request.url!, headers: request.headers, payload: chunks.length ? Buffer.concat(chunks).toString() : undefined });
      response.writeHead(result.statusCode, result.headers); response.end(result.body);
    } catch { response.writeHead(500); response.end('{}'); }
  });
  return {
    store, configurePredictionFailure() { predictionEnabled = true; },
    app: {
      inject,
      async listen({ port, host }: { port: number; host: string }) {
        await new Promise<void>(resolve => http.listen(port, host, resolve));
        const address = http.address();
        if (!address || typeof address === 'string') throw new Error('Synthetic fixture failed to listen');
        return `http://${host}:${address.port}`;
      },
      async close() { if (http.listening) await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); }
    }
  };
}
