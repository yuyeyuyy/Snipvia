import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const runPackaged = process.env.SNIPVIA_PACKAGED_SCREEN === '1';
const wait = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

type PackagedResult = {
  ok: boolean;
  sessionId?: string;
  backend?: string;
  fallbackUsed?: boolean;
  error?: string;
};

test('packaged application loads and captures through bundled ScreenCaptureKit helper', async () => {
  test.skip(!runPackaged, 'Set SNIPVIA_PACKAGED_SCREEN=1 after pnpm package.');
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-packaged-'));
  const resultPath = join(directory, 'packaged-result.json');
  const executablePath = resolve('dist/mac-arm64/Snipvia.app/Contents/MacOS/Snipvia');
  const child = spawn(executablePath, ['--snipvia-packaged-test', `--snipvia-packaged-test-result=${resultPath}`, `--user-data-dir=${directory}`], {
    env: { ...process.env, SNIPVIA_PACKAGED_TEST_CAPTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let diagnostics = '';
  let result: PackagedResult | undefined;
  const receive = (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-16_384);
    const line = diagnostics.split('\n').find((entry) => entry.startsWith('[Snipvia Packaged Test] '));
    if (line) result = JSON.parse(line.slice('[Snipvia Packaged Test] '.length)) as PackagedResult;
  };
  child.stdout.on('data', receive);
  child.stderr.on('data', receive);
  try {
    const deadline = Date.now() + 45_000;
    while (child.exitCode === null && Date.now() < deadline) {
      try {
        const candidate = JSON.parse(await readFile(resultPath, 'utf8')) as PackagedResult & { stage?: string };
        result = candidate;
        if (candidate.stage === 'capture-complete' || candidate.stage?.endsWith('-failed') || candidate.stage === 'renderer-process-gone') break;
      } catch { /* Result file has not been created yet. */ }
      await wait(100);
    }
    if (!result) throw new Error(`packaged self-test did not return a result; exit=${child.exitCode ?? 'running'}; diagnostics=${diagnostics}`);
    expect(result).toMatchObject({ ok: true, backend: 'screen-capture-kit', fallbackUsed: false });
    expect(result.sessionId).toMatch(/^capture_/);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())), wait(2000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});
