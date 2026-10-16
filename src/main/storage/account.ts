import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const sessionSchema = z.object({ origin: z.string(), cookie: z.string().max(4096), expiresAt: z.number() }).strict();
const diskSchema = z.object({ version: z.literal(1), encryptedSession: z.string().max(16384) }).strict();
export type AccountSession = z.infer<typeof sessionSchema>;
export interface AccountEncryption {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

// The cookie never enters Renderer, settings.json or a plaintext fallback file.
export class AccountSessionStore {
  constructor(private readonly file: string, private readonly encryption: AccountEncryption) {}

  load(origin: string, now: number): AccountSession | null {
    try {
      const disk = diskSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
      // A fresh installation has nothing to decrypt. Do not initialize the
      // macOS Keychain (which may prompt/block) before finding a stored session.
      if (!this.encryption.available()) return null;
      const session = sessionSchema.parse(JSON.parse(this.encryption.decrypt(Buffer.from(disk.encryptedSession, 'base64'))));
      if (session.origin !== origin || session.expiresAt <= now || !/^(?:__Secure-)?better-auth\.session_token=[^;\s]+$/.test(session.cookie)) {
        this.clear(); return null;
      }
      return session;
    } catch { return null; }
  }

  save(session: AccountSession): boolean {
    if (!this.encryption.available()) { this.clear(); return false; }
    const encryptedSession = this.encryption.encrypt(JSON.stringify(sessionSchema.parse(session))).toString('base64');
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, encryptedSession }), { mode: 0o600 });
    chmodSync(`${this.file}.tmp`, 0o600);
    renameSync(`${this.file}.tmp`, this.file);
    chmodSync(this.file, 0o600);
    return true;
  }

  clear() { rmSync(this.file, { force: true }); rmSync(`${this.file}.tmp`, { force: true }); }
}
