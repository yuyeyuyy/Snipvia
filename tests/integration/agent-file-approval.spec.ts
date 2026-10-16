import { launchDesktop } from '../helpers/desktop';
import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';

test('product file mutation and Undo stay disabled even with a real workspace grant', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-file-policy-'));
  const file = join(directory, 'example.ts'); await writeFile(file, 'original');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${join(directory, 'data')}`],
    env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const main = await app.firstWindow();
    await expect(main.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    const results = await app.evaluate(async ({ app }, directory) => {
      const mainFile = `${app.getAppPath()}/out/main/index.js`;
      const tools = process.getBuiltinModule('node:module').createRequire(mainFile)(mainFile).agentFileTools as ReturnType<typeof createFileToolSystem>;
      const workspace = await tools.workspaces.authorizeWorkspace(directory); const session = tools.permissions.createSession();
      try {
        return [
          await tools.executor.execute({ id: 'write', name: 'write_file', input: { path: 'example.ts', content: 'changed' } }, { workspace, session }),
          await tools.executor.execute({ id: 'edit', name: 'edit_file', input: { path: 'example.ts', edits: [{ search: 'original', replace: 'changed' }] } }, { workspace, session }),
          await tools.executor.undo('any', { workspace, session }),
          await tools.executor.execute({ id: 'read', name: 'read_file', input: { path: 'example.ts' } }, { workspace, session })
        ];
      } finally { tools.permissions.endSession(session); tools.workspaces.revoke(workspace); }
    }, directory);
    for (const result of results.slice(0, 3)) expect(result).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
    expect(results[3]).toMatchObject({ success: true }); expect(await readFile(file, 'utf8')).toBe('original');
    expect(app.windows().some((window) => window.url().endsWith('#agent-permission'))).toBe(false);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
