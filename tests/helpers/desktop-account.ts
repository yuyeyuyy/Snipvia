import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAccountFixture } from './account-fixture';

export async function createDesktopAccount(options: { predictionFetch?: typeof fetch } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-desktop-membership-'));
  const server = createAccountFixture(options);
  const origin = await server.app.listen({ port: 0, host: '127.0.0.1' });
  const actor = { id: 'test-bootstrap', email: 'bootstrap@example.test' };
  let closed = false;
  return { ...server, origin, actor,
    async signIn(page: Page, member = true, email = 'member@example.test') {
      const sent = await page.evaluate(email => window.snipvia.account.sendCode({ email }), email);
      if (!sent.ok || !sent.value.developmentCode) throw new Error('Synthetic account code unavailable');
      const signedIn = await page.evaluate(({ email, otp }) => window.snipvia.account.signIn({ email, otp }), { email, otp: sent.value.developmentCode });
      if (!signedIn.ok || !signedIn.value.user) throw new Error('Synthetic account login failed');
      const user = server.store.byEmail(email)!;
      if (member) server.store.issue(user.id, { source: 'gift', permanent: true, activation: 'now', reason: '合成会员测试', idempotencyKey: randomUUID() }, actor);
      await page.evaluate(() => window.snipvia.account.get());
      return user.id;
    },
    async close() {
      if (closed) return; closed = true;
      await server.app.close(); await rm(directory, { recursive: true, force: true });
    }
  };
}

export async function launchMemberDesktop(options: Parameters<typeof electron.launch>[0]): Promise<ElectronApplication> {
  const account = await createDesktopAccount();
  let instance: ElectronApplication | undefined;
  try {
    instance = await electron.launch({ ...options, env: { ...options?.env, SNIPVIA_CONSOLE_ORIGIN: account.origin } });
    await account.signIn(await instance.firstWindow());
    const close = instance.close.bind(instance);
    instance.close = async () => { try { await close(); } finally { await account.close(); } };
    return instance;
  } catch (error) { await instance?.close(); await account.close(); throw error; }
}
