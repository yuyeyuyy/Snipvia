import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { writeVerificationFiles } = require('../../scripts/macos-release/update-metadata.cjs') as {
  writeVerificationFiles(directory: string, report: object): void;
};
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-manifests-')); directories.push(directory);
  const artifacts = ['arm64', 'x64'].flatMap(arch => ['zip', 'dmg'].map(ext => {
    const name = `Snipvia-0.3.1-${arch}.${ext}`;
    const bytes = Buffer.from(name); writeFileSync(join(directory, name), bytes);
    return { name, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  return { directory, report: { version: '0.3.1', teamId: 'F76JCDMA4Y', artifacts } };
}
it('writes parseable JSON/YAML and one checksum per line without escaped newline suffixes', () => {
  const { directory, report } = fixture(); writeVerificationFiles(directory, report);
  expect(JSON.parse(readFileSync(join(directory, 'verification.json'), 'utf8'))).toEqual(report);
  const lines = readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8').trimEnd().split('\n');
  expect(lines).toEqual(report.artifacts.map(artifact => `${artifact.sha256}  ${artifact.name}`));
  const channel = JSON.parse(readFileSync(join(directory, 'latest-mac.yml'), 'utf8'));
  expect(channel.version).toBe('0.3.1'); expect(channel.files).toHaveLength(4);
  expect(() => writeVerificationFiles(directory, report)).toThrow();
});
it('rejects changed final artifacts before creating an update channel', () => {
  const { directory, report } = fixture(); writeFileSync(join(directory, report.artifacts[0].name), 'changed');
  expect(() => writeVerificationFiles(directory, report)).toThrow();
  expect(() => readFileSync(join(directory, 'latest-mac.yml'))).toThrow();
});
