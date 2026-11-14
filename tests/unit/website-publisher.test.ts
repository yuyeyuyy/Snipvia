import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
const downloadPlatforms = ['macos-arm64', 'macos-x64', 'windows-x64'] as const;
type DownloadArtifact = { id: string; platform: typeof downloadPlatforms[number]; version: string; filename: string; sha256: string; bytes: number; enabled: boolean; createdAt: number; url: string };
const installerFilename = (version: string, platform: typeof downloadPlatforms[number]) => platform === 'windows-x64' ? `Snipvia-Setup-${version}-x64.exe` : `Snipvia-${version}-${platform === 'macos-arm64' ? 'arm64' : 'x64'}.dmg`;
const latestDownloadRelease = (artifacts: DownloadArtifact[]) => ({ version: '1.0.2', artifacts });

it('发布工具完整预检后上传三包，安全重试不重传，错误不回显私密凭据', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'website-publisher-test-'));
  const token = '0123456789abcdef'.repeat(4); // Synthetic local fixture only.
  let origin = '', uploads = 0, requests = 0;
  const rows: DownloadArtifact[] = [];
  const server = createServer(async (request, response) => {
    try {
      requests++;
      const url = new URL(request.url!, origin);
      response.setHeader('content-type', 'application/json');
      if (url.pathname !== '/api/downloads' && (request.headers.authorization !== `Bearer ${token}` || request.headers.origin !== origin)) {
        response.writeHead(401).end('{}'); return;
      }
      const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      if (url.pathname.endsWith('/status')) response.end(JSON.stringify({ version: '1.0.2', artifacts: rows }));
      else if (url.pathname.endsWith('/upload')) {
        uploads++;
        const platform = url.searchParams.get('platform') as DownloadArtifact['platform'];
        const filename = url.searchParams.get('filename')!, sha256 = createHash('sha256').update(body).digest('hex');
        if (sha256 !== url.searchParams.get('sha256')) { response.writeHead(400).end('{}'); return; }
        const id = `v1.0.2-${platform}`;
        const item = { id, platform, version: '1.0.2', filename, sha256, bytes: body.length, enabled: false, createdAt: 1, url: `/downloads/${id}/${filename}` };
        rows.push(item); response.end(JSON.stringify(item));
      } else if (url.pathname.endsWith('/publish')) {
        const input = JSON.parse(body.toString());
        if (input.version !== '1.0.2' || rows.length !== 3) { response.writeHead(409).end('{}'); return; }
        rows.forEach(row => { row.enabled = true; }); response.end(JSON.stringify(latestDownloadRelease(rows)));
      } else if (url.pathname === '/api/downloads') response.end(JSON.stringify({ artifacts: rows, latest: latestDownloadRelease(rows) }));
      else response.writeHead(404).end('{}');
    } catch { response.writeHead(500).end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const credentials = join(directory, 'credentials.json'), receiptPath = join(directory, 'receipt.json');
    await writeFile(credentials, JSON.stringify({ origin, token }), { mode: 0o600 });
    const assets = [];
    for (const platform of downloadPlatforms) {
      const name = installerFilename('1.0.2', platform), bytes = Buffer.from(`fixture ${platform}`);
      await writeFile(join(directory, name), bytes);
      assets.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await writeFile(receiptPath, JSON.stringify({ version: '1.0.2', tag: 'v1.0.2', sourceCommit: 'a'.repeat(40), publishedAt: '2026-11-13T14:26:38Z',
      url: 'https://github.com/yuyeyuyy/Snipvia/releases/tag/v1.0.2', windowsConclusion: 'success', notarization: ['arm64', 'x64'].map(arch => ({ arch, status: 'Accepted' })), assets }));
    const args = [resolve('scripts/publish-website-release.mjs'), '--credentials', credentials, '--receipt', receiptPath, '--directory', directory];
    const run = () => promisify(execFile)(process.execPath, args, { env: { ...process.env, NODE_USE_ENV_PROXY: '0' }, timeout: 15_000 });
    const first = await run(); expect(first.stdout).toContain('官网已更新至 v1.0.2'); expect(first.stdout + first.stderr).not.toContain(token);
    const second = await run(); expect(second.stdout.match(/跳过上传/g)).toHaveLength(3); expect(uploads).toBe(3);
    const previous = requests;
    await writeFile(join(directory, assets[0].name), 'tampered');
    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('预检失败') });
    expect(requests).toBe(previous);
    await writeFile(credentials, `{"origin":"${origin}","token":${token}`, { mode: 0o600 });
    try { await run(); throw new Error('Expected credential parse failure'); }
    catch (error) { expect((error as { stderr?: string }).stderr).not.toContain(token); }
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
