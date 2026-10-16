import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ChatImages } from '../../src/main/chat/ChatImages';
import { imageDimensions } from '../../src/main/chat/image-validation';
import { providerImages } from '../../src/main/chat/provider-images';
import { readChatImage, pruneChatImages } from '../../src/main/storage/chat-images';
import { chatImageImportSchema, chatImageLimits, type ChatImage } from '../../src/shared/chat-images';
import { defaults } from '../../src/shared/contracts';
import { ContextManager } from '../../src/main/agent/ContextManager';
import { visionTestImage } from '../../src/main/ai/models/vision-test';

const runtime = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => runtime.directory }, nativeImage: {} }));
const png = Buffer.from(visionTestImage, 'base64');
const file = () => ({ name: '学习.png', bytes: png });
const store = () => new ChatImages(bytes => { imageDimensions(bytes); return { bytes, width: 64, height: 64 }; });
beforeEach(() => { vi.resetModules(); runtime.directory = mkdtempSync(join(tmpdir(), 'snipvia-chat-images-')); });
afterEach(() => rmSync(runtime.directory, { recursive: true, force: true }));

describe('图片输入格式与 Main 能力边界', () => {
  it('checks signatures and dimensions; rejects SVG, spoofed files, excessive bytes and decompression dimensions', () => {
    expect(imageDimensions(png)).toEqual({ width: 64, height: 64 });
    expect(() => imageDimensions(Buffer.from('<svg/>'))).toThrow('PNG / JPEG');
    expect(() => imageDimensions(Buffer.alloc(chatImageLimits.sourceBytes + 1))).toThrow('10 MiB');
    const huge = Buffer.from(png); huge.writeUInt32BE(16384, 16); huge.writeUInt32BE(16384, 20); expect(() => imageDimensions(huge)).toThrow('尺寸');
    const jpeg = Buffer.from([255,216,255,192,0,8,8,0,12,0,20,0]); expect(imageDimensions(jpeg)).toEqual({ width: 20, height: 12 });
    expect(() => imageDimensions(Buffer.from([255,216,255,192,255,255]))).toThrow();
    expect(chatImageImportSchema.safeParse({ conversationId: null, files: [{ name: 'x', bytes: png, path: '/private/x' }] }).success).toBe(false);
  });
  it('atomic imports, max-four limits, ownership and conversation binding prevent partial or unauthorized drafts', () => {
    const images = store(), scope = randomUUID();
    expect(() => images.add(1, null, [file(), { name: 'fake.png', bytes: Buffer.from('no') }])).toThrow();
    const selected = images.add(1, null, [file(), file(), file(), file()]); expect(() => images.add(1, null, [file()])).toThrow('最多');
    expect(() => images.preview(2, null, selected[0].id, [])).toThrow(); expect(() => images.begin(1, scope, [selected[0].id])).toThrow();
    images.bind(1, scope, selected.map(image => image.id));
    expect(() => images.preview(1, randomUUID(), selected[0].id, [])).toThrow();
    const lease = images.begin(1, scope, selected.map(image => image.id)); expect(() => images.remove(1, scope, selected[0].id)).toThrow('已发送');
    expect(() => images.begin(1, scope, [selected[0].id])).toThrow(); lease.release();
    images.remove(1, scope, selected[0].id); expect(() => images.preview(1, scope, selected[0].id, [])).toThrow();
  });
  it('keeps locked images through owner detachment, then releases drafts; private files have restricted modes and rollback', () => {
    const images = store(), scope = randomUUID(); const draft = images.add(1, scope, [file()]); images.begin(1, scope, draft.map(image => image.id));
    images.detach(1); expect(images.data(draft[0])).toEqual(png); images.release(draft);
    expect(() => images.preview(1, scope, draft[0].id, [])).toThrow();
    const next = images.add(1, scope, [file()]); const rollback = images.persist(next); const path = join(runtime.directory, 'history/attachments', `${next[0].id}.png`);
    expect(readChatImage(next[0])).toEqual(png); expect(statSync(path).mode & 0o777).toBe(0o600);
    rollback(); expect(existsSync(path)).toBe(false); expect(images.preview(1, scope, next[0].id, [])).toEqual(png);
    images.persist(next); images.committed(next); expect(images.preview(1, scope, next[0].id, next)).toEqual(png);
    pruneChatImages(new Set()); expect(existsSync(path)).toBe(false); expect(() => readChatImage(next[0])).toThrow('已损坏');
  });
  it('stores only validated references, reloads images and removes them together with deleted history', async () => {
    let history = await import('../../src/main/storage/history'); history.loadHistory();
    const conversation = history.createTextConversation(defaults), images = store(); const draft = images.add(1, conversation.id, [file()]);
    images.persist(draft); history.saveConversationAnswer(conversation.id, '理解图片', '合成图', defaults, { images: draft }); images.committed(draft);
    const serialized = readFileSync(join(runtime.directory, 'history/conversations.json'), 'utf8'); expect(serialized).not.toContain('base64'); expect(serialized).not.toContain('data:image');
    vi.resetModules(); history = await import('../../src/main/storage/history'); history.loadHistory();
    expect(history.readWorkspaceConversation(conversation.id, false).messages[0].images).toEqual(draft); expect(readChatImage(draft[0])).toEqual(png);
    history.saveConversationAnswer(conversation.id, '理解图片', '重生成', defaults, { images: draft, replaceMessages: history.readWorkspaceConversation(conversation.id, false).messages });
    expect(readChatImage(draft[0])).toEqual(png); history.deleteConversation(conversation.id);
    expect(() => readChatImage(draft[0])).toThrow();
  });
  it('Agent history accepts bounded UUID references and never accepts raw image bytes', () => {
    const context = new ContextManager(); expect(context.validateHistory([{ role: 'user', content: '图', imageIds: [randomUUID()] }])[0]).toHaveProperty('imageIds');
    expect(() => context.validateHistory([{ role: 'user', content: '图', imageIds: ['data:image/png;base64,SECRET'] }])).toThrow('历史');
  });
});

describe('有界多模态上下文', () => {
  const image = (bytes = png.length): ChatImage => ({ id: randomUUID(), name: '图片', mimeType: 'image/png', width: 64, height: 64, bytes });
  it('rejects unsupported current input, permits text-only turns and preserves unknown capabilities without fake vision', () => {
    const picture = image(), read = vi.fn(() => png);
    expect(() => providerImages([picture], [], 'unsupported', read)).toThrow('不支持');
    const text = providerImages([], [{ role: 'user', content: '前图', images: [picture] }], 'unsupported', read); expect(text.images.history.size).toBe(0); expect(read).not.toHaveBeenCalled(); expect(text.notice).toContain('仅发送文本');
    expect(providerImages([picture], [], 'unknown', read).images.current).toEqual([`data:image/png;base64,${visionTestImage}`]);
  });
  it('prioritizes current and newest pictures, limits payload, and skips missing history with an explicit notice', () => {
    const old = image(), latest = image(), current = image(); const read = (picture: ChatImage) => { if (picture.id === old.id) throw new Error('missing'); return png; };
    const result = providerImages([current], [{ role: 'user', content: 'old', images: [old] }, { role: 'user', content: 'latest', images: [latest] }], 'supported', read);
    expect(result.images.history.has(latest.id)).toBe(true); expect(result.images.history.has(old.id)).toBe(false); expect(result.notice).toContain('缺失');
    const history = Array.from({ length: 12 }, () => ({ role: 'user' as const, content: 'x', images: [image()] }));
    expect(providerImages([current], history, 'supported', () => png).images.history.size).toBe(7);
  });
});
