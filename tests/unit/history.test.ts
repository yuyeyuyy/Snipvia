import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults } from '../../src/shared/contracts';

const runtime = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => runtime.directory } }));

beforeEach(() => { vi.resetModules(); runtime.directory = mkdtempSync(join(tmpdir(), 'snipvia-history-')); });
afterEach(() => rmSync(runtime.directory, { recursive: true, force: true }));

describe('local conversation history', () => {
  it('renames without altering ordering or transcript, preserves the title through replies, regeneration and reload', async () => {
    let history = await import('../../src/main/storage/history'); history.loadHistory();
    const record = history.createTextConversation(defaults);
    history.saveConversationAnswer(record.id, '原问题', '原回答', defaults);
    const before = history.readWorkspaceConversation(record.id, false);
    const renamed = history.renameConversation(record.id, '  算法学习  ');
    expect(renamed).toMatchObject({ title: '算法学习', updatedAt: before.updatedAt, profile: before.profile });
    expect(history.readWorkspaceConversation(record.id, false).messages).toEqual(before.messages);
    history.saveConversationAnswer(record.id, '继续', '第二个回答', defaults);
    const messages = history.readWorkspaceConversation(record.id, false).messages;
    history.saveConversationAnswer(record.id, '继续', '重新生成', defaults, { replaceMessages: messages });
    vi.resetModules(); history = await import('../../src/main/storage/history'); history.loadHistory();
    expect(history.readWorkspaceConversation(record.id, false).title).toBe('算法学习');
    expect(history.readWorkspaceConversation(record.id, false).messages.at(-1)?.previousAnswers).toEqual(['第二个回答']);
  });
  it('rejects invalid titles and rolls back a failed rename without touching the index', async () => {
    const history = await import('../../src/main/storage/history'); history.loadHistory();
    const record = history.createTextConversation(defaults);
    for (const title of ['', ' ', 'a'.repeat(121), 'a\nb', 'a\u0000b', 'a\u2028b']) expect(() => history.renameConversation(record.id, title)).toThrow();
    expect(() => history.renameConversation(crypto.randomUUID(), '名称')).toThrow('已被删除');
    const path = join(runtime.directory, 'history/conversations.json'); const before = readFileSync(path, 'utf8');
    mkdirSync(`${path}.tmp`);
    expect(() => history.renameConversation(record.id, '不能保存的名称')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(before); expect(history.listConversations()[0].title).toBe('新对话');
    rmSync(`${path}.tmp`, { recursive: true });
    history.saveConversationAnswer(record.id, '自动标题仍然有效', '回答', defaults);
    expect(history.listConversations()[0].title).toBe('自动标题仍然有效');
  });
  it('persists validated proposal summaries and actual note changes across restart without storing temporary previews', async () => {
    let history = await import('../../src/main/storage/history'); history.loadHistory();
    const record = history.createTextConversation(defaults);
    const proposal = { id: crypto.randomUUID(), digest: 'a'.repeat(64), kind: 'note' as const, title: '算法.md', status: 'pending' as const, added: 2, removed: 1, note: { notebookId: crypto.randomUUID(), path: '算法.md' } };
    history.saveConversationAnswer(record.id, '整理笔记', '请查看建议后确认。', defaults, { editProposals: [proposal] });
    const change = { id: proposal.id, notebookId: proposal.note.notebookId, notebookName: '算法', path: '算法.md', operation: 'edit' as const, added: 2, removed: 1 };
    history.recordAppliedProposal(record.id, { ...proposal, status: 'applied', message: '修改已保存' }, [change]);
    history.recordAppliedProposal(record.id, { ...proposal, status: 'applied' }, [change]);
    vi.resetModules(); history = await import('../../src/main/storage/history'); history.loadHistory();
    const saved = history.readWorkspaceConversation(record.id, false).messages.at(-1)!;
    expect(saved.editProposals).toMatchObject([{ id: proposal.id, status: 'applied' }]); expect(saved.noteChanges).toEqual([change]);
    const stored = readFileSync(join(runtime.directory, 'history/conversations.json'), 'utf8');
    expect(stored).not.toContain('beforeHash'); expect(stored).not.toContain('proposalScope');
    await expect(async () => history.saveConversationAnswer(record.id, '非法', 'x', defaults, { editProposals: [{ ...proposal, before: 'PRIVATE_PREVIEW' } as never] })).rejects.toThrow();
    expect(readFileSync(join(runtime.directory, 'history/conversations.json'), 'utf8')).toBe(stored);
  });
  it('persists the screenshot, messages, title and selected model across reloads', async () => {
    let history = await import('../../src/main/storage/history');
    history.loadHistory();
    const created = history.createConversation({
      id: crypto.randomUUID(), width: 32, height: 24, createdAt: '2026-09-16T04:00:00.000Z'
    }, Buffer.from('jpeg fixture'), defaults);
    expect(history.listConversations()).toMatchObject([{ id: created.id, title: '新截图', messageCount: 0 }]);
    const noteChange = { id: crypto.randomUUID(), notebookId: crypto.randomUUID(), notebookName: '算法笔记', path: '二分查找.md', operation: 'create' as const, added: 8, removed: 0 };
    history.saveConversationMessages(created.id, [
      { role: 'user', content: '  请总结这张截图\n的重点  ', createdAt: '2026-09-16T04:01:00.000Z' },
      { role: 'assistant', content: '## 摘要', noteChanges: [noteChange], sources: [{ url: 'https://example.com/docs', title: '官方文档', snippet: '已读取正文', read: true }], provider: 'qwen', model: 'qwen3.8-max', createdAt: '2026-09-16T04:01:01.000Z' }
    ], { provider: 'qwen', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-max' });
    expect(history.listConversations()[0]).toMatchObject({ title: '请总结这张截图 的重点', messageCount: 2, profile: { model: 'qwen3.8-max' } });
    const originalCaptureFile = join(runtime.directory, 'history', 'captures', `${created.capture.id}.jpg`);
    const continuedCaptureId = crypto.randomUUID();
    const continued = history.replaceConversationCapture(created.id, {
      id: continuedCaptureId, width: 64, height: 48, createdAt: '2026-09-16T04:02:00.000Z'
    }, Buffer.from('continued jpeg'));
    expect(continued).toMatchObject({
      id: created.id,
      capture: { id: continuedCaptureId, continuesConversation: true },
      messages: [{ role: 'user' }, { role: 'assistant' }]
    });
    expect(existsSync(originalCaptureFile)).toBe(false);

    vi.resetModules();
    history = await import('../../src/main/storage/history');
    history.loadHistory();
    const restored = history.readConversation(created.id);
    expect(restored.capture.dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('continued jpeg').toString('base64')}`);
    expect(restored.capture.continuesConversation).toBe(true);
    expect(restored.messages[1]).toMatchObject({ content: '## 摘要', model: 'qwen3.8-max', sources: [{ url: 'https://example.com/docs', title: '官方文档', read: true }] });
    expect(restored.messages[1].noteChanges).toEqual([noteChange]);
    expect(JSON.parse(readFileSync(join(runtime.directory, 'history', 'conversations.json'), 'utf8'))[0].capture).not.toHaveProperty('dataUrl');
  });

  it('deletes one conversation or clears all screenshots', async () => {
    const history = await import('../../src/main/storage/history');
    history.loadHistory();
    const first = history.createConversation({ id: crypto.randomUUID(), width: 10, height: 10, createdAt: new Date().toISOString() }, Buffer.from('one'), defaults);
    history.createConversation({ id: crypto.randomUUID(), width: 20, height: 20, createdAt: new Date().toISOString() }, Buffer.from('two'), defaults);
    const firstFile = join(runtime.directory, 'history', 'captures', `${first.capture.id}.jpg`);
    expect(existsSync(firstFile)).toBe(true);
    history.deleteConversation(first.id);
    expect(existsSync(firstFile)).toBe(false);
    expect(history.listConversations()).toHaveLength(1);
    expect(history.clearConversations()).toBe(true);
    expect(history.listConversations()).toEqual([]);
  });

  it('persists text conversations without creating an image and keeps earlier answers on regeneration', async () => {
    let history = await import('../../src/main/storage/history'); history.loadHistory();
    const record = history.createTextConversation(defaults);
    expect(record.capture).toBeUndefined();
    expect(readdirSync(join(runtime.directory, 'history', 'captures'))).toEqual([]);
    expect(() => history.readConversation(record.id)).toThrow('没有截图');
    const before = history.saveConversationAnswer(record.id, '问题', '原回答', defaults);
    history.saveConversationAnswer(record.id, '问题', '新回答', defaults, { replaceMessages: before });
    expect(history.readWorkspaceConversation(record.id).messages).toHaveLength(2);
    expect(history.readWorkspaceConversation(record.id).messages.at(-1)).toMatchObject({ content: '新回答', previousAnswers: ['原回答'] });
    const persisted = readFileSync(join(runtime.directory, 'history', 'conversations.json'), 'utf8');
    expect(() => history.saveConversationAnswer(record.id, '问题', '过期覆盖', defaults, { replaceMessages: before })).toThrow('原回答保留');
    expect(readFileSync(join(runtime.directory, 'history', 'conversations.json'), 'utf8')).toBe(persisted);
    vi.resetModules(); history = await import('../../src/main/storage/history'); history.loadHistory();
    expect(history.readWorkspaceConversation(record.id).messages.at(-1)?.previousAnswers).toEqual(['原回答']);
    history.deleteConversation(record.id); history.createTextConversation(defaults); history.clearConversations();
    expect(history.listConversations()).toEqual([]);
  });

  it('refuses to overwrite a malformed history index', async () => {
    const directory = join(runtime.directory, 'history');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'conversations.json'), '{broken');
    const history = await import('../../src/main/storage/history');
    expect(() => history.loadHistory()).toThrow();
    expect(() => history.createConversation({ id: crypto.randomUUID(), width: 10, height: 10, createdAt: new Date().toISOString() }, Buffer.from('new'), defaults)).toThrow('未就绪');
    expect(readFileSync(join(directory, 'conversations.json'), 'utf8')).toBe('{broken');
  });
});
