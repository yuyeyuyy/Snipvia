import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { reviewedSupplement } = require('../../scripts/opensource/license-supplements.cjs') as {
  reviewedSupplement(directory: string, metadata: Record<string, unknown>): { bytes: Buffer; file: string; originalNoticeSupplied: false } | null;
};
const source = path.resolve('node_modules/.pnpm/lazy-val@1.0.5/node_modules/lazy-val');
const metadata = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')) as Record<string, unknown>;
const temporary: string[] = [];
afterEach(() => { for (const folder of temporary.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe('reviewed production license supplement boundary', () => {
  it('includes the declared MIT grant and accurate attribution without claiming an original copyright notice', () => {
    const result = reviewedSupplement(source, metadata);
    expect(result?.originalNoticeSupplied).toBe(false);
    expect(result?.bytes.toString()).toContain('Permission is hereby granted');
    expect(result?.bytes.toString()).toContain('Vladimir Krivosheev');
    expect(result?.bytes.toString()).toContain('NOT an original upstream LICENSE');
  });
  it('does not infer clearance for other packages or versions', () => {
    expect(reviewedSupplement(source, { ...metadata, name: 'unknown' })).toBeNull();
    expect(reviewedSupplement(source, { ...metadata, version: '1.0.6' })).toBeNull();
  });
  it('rejects changed license or author declarations', () => {
    expect(() => reviewedSupplement(source, { ...metadata, license: 'UNLICENSED' })).toThrow('metadata changed');
    expect(() => reviewedSupplement(source, { ...metadata, author: 'other' })).toThrow('metadata changed');
  });
  it('rejects changed package contents even when name and version match', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'snipvia-license-'));
    temporary.push(directory);
    cpSync(source, directory, { recursive: true });
    writeFileSync(path.join(directory, 'out/main.js'), 'changed published code');
    expect(() => reviewedSupplement(directory, metadata)).toThrow('contents changed');
  });
});
