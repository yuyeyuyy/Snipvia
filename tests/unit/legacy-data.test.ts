import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LegacyDataService } from '../../src/main/legacy/LegacyDataService';
import { ScreenshotStore } from '../../src/main/storage/ScreenshotStore';
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snipvia-legacy-')); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function seed() {
  const capture = { id: crypto.randomUUID(), fileName: '', width: 2, height: 2, createdAt: new Date().toISOString() }; capture.fileName = capture.id + '.jpg';
  mkdirSync(join(directory, 'history/captures'), { recursive: true }); mkdirSync(join(directory, 'schedule/captures'), { recursive: true });
  writeFileSync(join(directory, 'history/captures', capture.fileName), Buffer.from([255, 216, 255, 217]));
  const attachmentId = crypto.randomUUID(); mkdirSync(join(directory, 'history/attachments'));
  writeFileSync(join(directory, 'history/attachments', attachmentId + '.png'), 'SYNTHETIC_ATTACHMENT');
  const record = { id: crypto.randomUUID(), title: '旧对话', createdAt: capture.createdAt, messages: [{ role: 'assistant', content: '旧内容' }, { role: 'user', content: '旧图片', images: [{ id: attachmentId }] }], capture };
  writeFileSync(join(directory, 'history/conversations.json'), JSON.stringify([record]));
  writeFileSync(join(directory, 'schedule/jobs.json'), JSON.stringify([{ ...record, title: '旧日程', events: [{ title: '必须保留的会议', notes: '原备注' }] }]));
  const book = { id: crypto.randomUUID(), name: '外部笔记', directory: join(directory, 'external-notes') }; mkdirSync(book.directory);
  writeFileSync(join(book.directory, 'note.md'), '# Keep original');
  writeFileSync(join(directory, 'notebooks.json'), JSON.stringify({ activeId: book.id, notebooks: [book] }));
  writeFileSync(join(directory, 'credentials.json'), 'NOT_FOR_EXPORT');
  return { capture, record, book, attachmentId, history: readFileSync(join(directory, 'history/conversations.json')), schedule: readFileSync(join(directory, 'schedule/jobs.json')) };
}
describe('read-only v1 compatibility', () => {
  it('performs no startup IO and reads old conversations, schedule events and notebook locations on demand', async () => {
    const empty = new LegacyDataService(join(directory, 'does-not-exist'));
    expect(readdirSync(directory)).toEqual([]);
    expect(await empty.read()).toEqual({ conversations: [], schedule: [], notebooks: [], errors: [] });
    const fixture = seed(), service = new LegacyDataService(directory);
    const read = await service.read();
    expect(read.conversations[0].detail).toContain('旧内容'); expect(read.schedule[0].detail).toContain('必须保留的会议');
    expect(read.notebooks).toEqual([fixture.book]); expect(await service.notebookDirectory(fixture.book.id)).toBe(realpathSync.native(fixture.book.directory));
    expect(readFileSync(join(directory, 'history/conversations.json'))).toEqual(fixture.history);
    expect(readFileSync(join(directory, 'schedule/jobs.json'))).toEqual(fixture.schedule);
  });
  it('copies old captures idempotently, preserves both sources and allows independent deletion', async () => {
    const fixture = seed(), service = new LegacyDataService(directory), store = new ScreenshotStore(join(directory, 'screenshots'));
    expect(await service.importScreenshots(store)).toEqual({ imported: 1, existing: 1, errors: [] });
    expect(await service.importScreenshots(new ScreenshotStore(join(directory, 'screenshots')))).toEqual({ imported: 0, existing: 2, errors: [] });
    expect(store.list()[0]).toMatchObject({ id: fixture.capture.id, legacyCaptureId: fixture.capture.id, status: 'saved' });
    store.delete(fixture.capture.id);
    expect(readFileSync(join(directory, 'history/captures', fixture.capture.fileName))).toEqual(Buffer.from([255, 216, 255, 217]));
    expect(readFileSync(join(directory, 'history/conversations.json'))).toEqual(fixture.history);
    expect(readFileSync(join(directory, 'schedule/jobs.json'))).toEqual(fixture.schedule);
  });
  it('does not overwrite damaged indexes or mutate a missing source during repeated migration', async () => {
    const fixture = seed(), service = new LegacyDataService(directory), folder = join(directory, 'screenshots');
    mkdirSync(folder); writeFileSync(join(folder, 'index.json'), 'broken');
    await expect(service.importScreenshots(new ScreenshotStore(folder))).rejects.toThrow();
    expect(readFileSync(join(directory, 'history/conversations.json'))).toEqual(fixture.history);
    rmSync(join(directory, 'history/captures', fixture.capture.fileName));
    rmSync(join(folder, 'index.json')); writeFileSync(join(directory, 'schedule/jobs.json'), 'broken schedule');
    const result = await service.importScreenshots(new ScreenshotStore(folder)); expect(result.imported).toBe(0); expect(result.errors).toHaveLength(2);
    expect((await service.read()).errors).toHaveLength(1);
    expect(readFileSync(join(directory, 'schedule/jobs.json'), 'utf8')).toBe('broken schedule');
  });
  it('exports only eligible legacy indexes and images and never credentials or external Markdown', async () => {
    const fixture = seed(), service = new LegacyDataService(directory), output = join(directory, 'legacy.zip');
    await service.exportTo(output);
    const zip = readFileSync(output);
    for (const name of ['history/conversations.json', 'schedule/jobs.json', 'notebooks.json', fixture.capture.fileName, 'history/attachments/' + fixture.attachmentId + '.png', 'EXPORT_STATUS.json', 'README.txt']) expect(zip.includes(Buffer.from(name))).toBe(true);
    expect(readFileSync(join(directory, 'history/attachments', fixture.attachmentId + '.png'), 'utf8')).toBe('SYNTHETIC_ATTACHMENT');
    expect(zip.includes(Buffer.from('credentials.json'))).toBe(false); expect(zip.includes(Buffer.from('note.md'))).toBe(false);
    expect(readFileSync(join(fixture.book.directory, 'note.md'), 'utf8')).toBe('# Keep original');
    await expect(service.exportTo(output)).rejects.toThrow();
  });
  it('rejects symlinked old image directories rather than importing unrelated files', async () => {
    const fixture = seed(), service = new LegacyDataService(directory);
    const folder = join(directory, 'history/captures'); rmSync(folder, { recursive: true }); symlinkSync(fixture.book.directory, folder);
    writeFileSync(join(fixture.book.directory, fixture.capture.fileName), 'not-a-capture');
    const result = await service.importScreenshots(new ScreenshotStore(join(directory, 'screenshots')));
    expect(result.imported).toBe(0); expect(result.errors[0]).toContain('未导入');
  });
});
