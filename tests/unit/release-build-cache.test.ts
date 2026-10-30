import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Node 24 supports requiring this synchronous ESM tooling without a build step.
const { fingerprint, canReuse, buildCommand } = require('../../scripts/prepare-release-build.mjs') as {
  buildCommand(command: string, args: string[], context: { platform: string; node?: string; pnpm?: string }): { command: string; args: string[] };
  fingerprint(root: string, files: string[], context?: Record<string, unknown>): string;
  canReuse(receipt: unknown, input: string, output: string): boolean;
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'snipvia-release-cache-'));
  roots.push(root);
  writeFileSync(join(root, 'source'), 'original');
  writeFileSync(join(root, 'output'), 'built');
  return root;
}

describe('release build evidence', () => {
  it('reuses only passed evidence for identical inputs and outputs', () => {
    expect(canReuse({ schema: 1, passed: true, input: 'a', output: 'b' }, 'a', 'b')).toBe(true);
    for (const receipt of [null, {}, { schema: 1, passed: false, input: 'a', output: 'b' },
      { schema: 2, passed: true, input: 'a', output: 'b' }]) expect(canReuse(receipt, 'a', 'b')).toBe(false);
    expect(canReuse({ schema: 1, passed: true, input: 'a', output: 'b' }, 'c', 'b')).toBe(false);
    expect(canReuse({ schema: 1, passed: true, input: 'a', output: 'b' }, 'a', 'c')).toBe(false);
  });
  it('invalidates modified content, file lists and toolchains', () => {
    const root = fixture();
    const original = fingerprint(root, ['source'], { node: '24.15.0' });
    expect(fingerprint(root, ['source'], { node: '24.15.1' })).not.toBe(original);
    expect(fingerprint(root, ['source', 'output'], { node: '24.15.0' })).not.toBe(original);
    writeFileSync(join(root, 'source'), 'modified');
    expect(fingerprint(root, ['source'], { node: '24.15.0' })).not.toBe(original);
  });
  it('hashes permissions and fails closed for missing files', () => {
    const root = fixture();
    chmodSync(join(root, 'source'), 0o644);
    const before = fingerprint(root, ['source']);
    chmodSync(join(root, 'source'), 0o444);
    expect(fingerprint(root, ['source'])).not.toBe(before);
    chmodSync(join(root, 'source'), 0o644);
    expect(() => fingerprint(root, ['missing'])).toThrow();
  });
  it('uses a stable file order', () => {
    const root = fixture();
    expect(fingerprint(root, ['source', 'output'])).toBe(fingerprint(root, ['output', 'source']));
  });
});

describe('cross-platform build invocation', () => {
  it('keeps POSIX tools and Windows executables as literal argument arrays', () => {
    expect(buildCommand('pnpm', ['build'], { platform: 'darwin' })).toEqual({ command: 'pnpm', args: ['build'] });
    expect(buildCommand('git', ['status'], { platform: 'win32' })).toEqual({ command: 'git', args: ['status'] });
  });
  it('uses the active pnpm CLI through Node without a Windows command shell', () => {
    const node = 'C:\\Program Files\\nodejs\\node.exe', pnpm = 'C:\\Tools With Spaces\\pnpm.cjs';
    const args = ['build', 'literal&argument', '$(literal)'];
    expect(buildCommand('pnpm', args, { platform: 'win32', node, pnpm })).toEqual({ command: node, args: [pnpm, ...args] });
  });
  it('rejects missing, relative or unrelated Windows package-manager entry points', () => {
    for (const pnpm of ['', 'pnpm.cjs', 'C:\\Tools\\npm-cli.js']) {
      expect(() => buildCommand('pnpm', ['build'], { platform: 'win32', pnpm })).toThrow('through pnpm');
    }
  });
});
