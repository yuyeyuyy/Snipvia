import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { releaseSource } = require('../../scripts/macos-release/common.cjs') as { releaseSource(query: (args: string[]) => string): string };

it('records only a full commit from a clean source tree', () => {
  const commit = 'a'.repeat(40), calls: string[][] = [];
  expect(releaseSource(args => { calls.push(args); return args[0] === 'status' ? '' : commit + '\n'; })).toBe(commit);
  expect(calls).toEqual([['status', '--porcelain', '--untracked-files=normal'], ['rev-parse', 'HEAD']]);
});
it('refuses tracked, staged, untracked and malformed source state before packaging', () => {
  for (const status of [' M src/main/index.ts', 'M  package.json', '?? native/new.swift']) {
    expect(() => releaseSource(args => args[0] === 'status' ? status : 'a'.repeat(40))).toThrow('先提交');
  }
  expect(() => releaseSource(args => args[0] === 'status' ? '' : 'main')).toThrow('源码提交');
});
