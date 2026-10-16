import { proposalSummarySchema, type ProposalSummary } from '../../shared/agent/editing';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { providerIds } from '../../shared/providers';
import type { Capture, Conversation, ConversationSummary, Message, ModelProfile, WorkspaceConversation } from '../../shared/contracts';
import { screenshotPerformance } from '../performance/screenshot-performance';
import { webSourcesSchema } from '../../shared/agent/source-schema';
import { noteChangesSchema } from '../../shared/agent/note-writing';
import { chatImageSchema, chatImageLimits, type ChatImage } from '../../shared/chat-images';
import { pruneChatImages, removeChatImages } from './chat-images';
import { conversationRenameSchema } from '../../shared/history';

const profileSchema = z.object({
  provider: z.enum(providerIds), endpoint: z.string().url().max(500), model: z.string().min(1).max(100)
});
const messageSchema = z.object({
  images: z.array(chatImageSchema).max(chatImageLimits.perTurn).refine(images => new Set(images.map(image => image.id)).size === images.length, '图片不能重复').optional(),
  editProposals: z.array(proposalSummarySchema).max(4).optional(),
  previousAnswers: z.array(z.string().max(500_000)).max(5).optional(),
  role: z.enum(['user', 'assistant']), content: z.string().max(500_000), createdAt: z.string().optional(),
  provider: z.enum(providerIds).optional(), model: z.string().max(100).optional(), sources: webSourcesSchema.optional(), noteChanges: noteChangesSchema.optional()
}).refine(message => message.role === 'user' || !message.images?.length, '仅用户消息包含图片附件');
const storedConversationSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(120), createdAt: z.string(), updatedAt: z.string(),
  titleMode: z.literal('manual').optional(),
  profile: profileSchema, messages: z.array(messageSchema),
  capture: z.object({
    id: z.string().uuid(), fileName: z.string().regex(/^[0-9a-f-]+\.jpg$/),
    width: z.number().int().positive(), height: z.number().int().positive(), createdAt: z.string(),
    continuesConversation: z.boolean().default(false)
  }).optional()
});
type StoredConversation = z.infer<typeof storedConversationSchema>;

let conversations: StoredConversation[] = [];
let available = false;
const root = () => join(app.getPath('userData'), 'history');
const captures = () => join(root(), 'captures');
const indexFile = () => join(root(), 'conversations.json');

function ensureDirectories(performanceSessionId?: string) {
  screenshotPerformance.mark(performanceSessionId, 'history_mkdir_start');
  mkdirSync(captures(), { recursive: true, mode: 0o700 });
  screenshotPerformance.mark(performanceSessionId, 'history_mkdir_end');
}

function assertAvailable() {
  if (!available) throw new Error('历史记录未就绪，请重启应用或检查历史索引文件');
}

function persist(performanceSessionId?: string) {
  ensureDirectories(performanceSessionId);
  const temporary = `${indexFile()}.tmp`;
  screenshotPerformance.mark(performanceSessionId, 'history_json_serialize_start');
  const serialized = JSON.stringify(conversations, null, 2);
  screenshotPerformance.mark(performanceSessionId, 'history_json_serialize_end', 'main', { bytes: Buffer.byteLength(serialized) });
  screenshotPerformance.mark(performanceSessionId, 'history_json_write_start');
  writeFileSync(temporary, serialized, { mode: 0o600 });
  screenshotPerformance.mark(performanceSessionId, 'history_json_write_end');
  screenshotPerformance.mark(performanceSessionId, 'history_json_rename_start');
  renameSync(temporary, indexFile());
  screenshotPerformance.mark(performanceSessionId, 'history_json_rename_end');
}

function profileOf(profile: ModelProfile): ModelProfile {
  return { provider: profile.provider, endpoint: profile.endpoint, model: profile.model };
}

function summaryOf(item: StoredConversation): ConversationSummary {
  return {
    id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt,
    messageCount: item.messages.length, profile: profileOf(item.profile)
  };
}

export function loadHistory() {
  available = false;
  ensureDirectories();
  if (!existsSync(indexFile())) { conversations = []; available = true; pruneChatImages(new Set()); return; }
  conversations = z.array(storedConversationSchema).parse(JSON.parse(readFileSync(indexFile(), 'utf8')));
  available = true;
  pruneChatImages(historyImageIds());
}
export function historyImageIds() { return new Set(conversations.flatMap(item => item.messages.flatMap(message => message.images?.map(image => image.id) ?? []))); }
export function capturedConversations() { assertAvailable(); return conversations.filter(item => item.capture).map(({ id, title, createdAt }) => ({ id, title, createdAt })); }

export function createConversation(
  capture: Omit<Capture, 'conversationId' | 'dataUrl'>,
  jpeg: Buffer,
  profile: ModelProfile,
  performanceSessionId?: string
): Conversation {
  assertAvailable();
  const id = randomUUID();
  const fileName = `${capture.id}.jpg`;
  const temporary = join(captures(), `${fileName}.tmp`);
  ensureDirectories(performanceSessionId);
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_write_start', 'main', { bytes: jpeg.byteLength });
  writeFileSync(temporary, jpeg, { mode: 0o600 });
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_write_end');
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_rename_start');
  renameSync(temporary, join(captures(), fileName));
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_rename_end');
  const item: StoredConversation = {
    id, title: '新截图', createdAt: capture.createdAt, updatedAt: capture.createdAt,
    profile: profileOf(profile), messages: [], capture: { ...capture, fileName, continuesConversation: false }
  };
  conversations.unshift(item);
  try { persist(performanceSessionId); }
  catch (error) {
    conversations.shift();
    if (existsSync(join(captures(), fileName))) unlinkSync(join(captures(), fileName));
    throw error;
  }
  return readConversation(id, performanceSessionId);
}

export function listConversations(): ConversationSummary[] {
  assertAvailable();
  return conversations
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(summaryOf);
}

/** Screenshot-only API retained for capture and floating-window callers. */
export function readConversation(id: string, performanceSessionId?: string): Conversation {
  const value = readWorkspaceConversation(id, true, performanceSessionId);
  if (!value.capture) throw new Error('这条对话没有截图');
  return { ...value, capture: value.capture };
}

export function createTextConversation(profile: ModelProfile): WorkspaceConversation {
  assertAvailable();
  const now = new Date().toISOString();
  const item: StoredConversation = { id: randomUUID(), title: '新对话', createdAt: now, updatedAt: now, profile: profileOf(profile), messages: [] };
  conversations.unshift(item);
  try { persist(); } catch (error) { conversations.shift(); throw error; }
  return readWorkspaceConversation(item.id);
}

/** Metadata-only reads keep stream projections away from image disk IO. */
export function readWorkspaceConversation(id: string, includeImage = true, performanceSessionId?: string): WorkspaceConversation {
  assertAvailable();
  screenshotPerformance.mark(performanceSessionId, 'history_read_start');
  const item = conversations.find((conversation) => conversation.id === id);
  if (!item) throw new Error('历史对话不存在或已被删除');
  if (!item.capture || !includeImage) return { ...summaryOf(item), messages: structuredClone(item.messages) };
  const file = join(captures(), basename(item.capture.fileName));
  if (!existsSync(file)) throw new Error('历史截图文件不存在');
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_read_start');
  const jpeg = readFileSync(file);
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_read_end', 'main', { bytes: jpeg.byteLength });
  screenshotPerformance.mark(performanceSessionId, 'second_base64_start');
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  screenshotPerformance.mark(performanceSessionId, 'second_base64_end', 'main', { characters: dataUrl.length });
  const conversation = {
    ...summaryOf(item),
    capture: {
      id: item.capture.id, conversationId: item.id, dataUrl,
      width: item.capture.width, height: item.capture.height, createdAt: item.capture.createdAt,
      ...(item.capture.continuesConversation ? { continuesConversation: true } : {})
    },
    messages: item.messages.map((message) => ({ ...message }))
  };
  screenshotPerformance.mark(performanceSessionId, 'history_read_end');
  return conversation;
}

export function replaceConversationCapture(
  id: string,
  capture: Omit<Capture, 'conversationId' | 'dataUrl' | 'continuesConversation'>,
  jpeg: Buffer,
  performanceSessionId?: string
): Conversation {
  assertAvailable();
  const item = conversations.find((conversation) => conversation.id === id);
  if (!item) throw new Error('要继续的历史对话不存在或已被删除');
  const fileName = `${capture.id}.jpg`;
  const temporary = join(captures(), `${fileName}.tmp`);
  const target = join(captures(), fileName);
  if (!item.capture) throw new Error('这条对话没有截图');
  const previous = { capture: item.capture, updatedAt: item.updatedAt };
  ensureDirectories(performanceSessionId);
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_write_start', 'main', { bytes: jpeg.byteLength });
  writeFileSync(temporary, jpeg, { mode: 0o600 });
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_write_end');
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_rename_start');
  renameSync(temporary, target);
  screenshotPerformance.mark(performanceSessionId, 'jpeg_disk_rename_end');
  item.capture = { ...capture, fileName, continuesConversation: true };
  item.updatedAt = capture.createdAt;
  try { persist(performanceSessionId); }
  catch (error) {
    item.capture = previous.capture;
    item.updatedAt = previous.updatedAt;
    if (existsSync(target)) unlinkSync(target);
    throw error;
  }
  const previousFile = join(captures(), basename(previous.capture.fileName));
  if (previousFile !== target && existsSync(previousFile)) unlinkSync(previousFile);
  return readConversation(id, performanceSessionId);
}

export function saveConversationMessages(id: string, messages: Message[], profile: ModelProfile) {
  assertAvailable();
  const item = conversations.find((conversation) => conversation.id === id);
  if (!item) throw new Error('历史对话不存在或已被删除');
  const previous = { messages: item.messages, profile: item.profile, updatedAt: item.updatedAt, title: item.title };
  item.messages = messages.map((message) => messageSchema.parse(message));
  item.profile = profileOf(profile);
  item.updatedAt = new Date().toISOString();
  const firstQuestion = item.messages.find((message) => message.role === 'user')?.content.replace(/\s+/g, ' ').trim();
  if (firstQuestion && item.titleMode !== 'manual') item.title = firstQuestion.slice(0, 60);
  try { persist(); }
  catch (error) { Object.assign(item, previous); throw error; }
}

/** Regeneration commits only against the exact transcript it started from. */
export function saveConversationAnswer(id: string, question: string, answer: string, profile: ModelProfile,
  options: { images?: ChatImage[]; editProposals?: ProposalSummary[]; replaceMessages?: Message[]; sources?: Message['sources']; noteChanges?: Message['noteChanges'] } = {}): Message[] {
  const stored = readWorkspaceConversation(id, false);
  if (options.replaceMessages && (JSON.stringify(stored.messages) !== JSON.stringify(options.replaceMessages) || stored.messages.at(-2)?.role !== 'user' || stored.messages.at(-2)?.content !== question || stored.messages.at(-1)?.role !== 'assistant')) throw new Error('对话已变化，原回答保留');
  const messages: Message[] = [...(options.replaceMessages ? stored.messages.slice(0, -2) : stored.messages),
    { role: 'user', content: question, createdAt: new Date().toISOString(), ...(options.images?.length ? { images: options.images } : {}) },
    { role: 'assistant', content: answer, createdAt: new Date().toISOString(), provider: profile.provider, model: profile.model,
      ...(options.replaceMessages ? { previousAnswers: [...(stored.messages.at(-1)?.previousAnswers ?? []), stored.messages.at(-1)!.content].slice(-5) } : {}),
      ...(options.editProposals?.length ? { editProposals: options.editProposals } : {}),
      ...(options.sources?.length ? { sources: options.sources } : {}), ...(options.noteChanges?.length ? { noteChanges: options.noteChanges } : {}) }];
  saveConversationMessages(id, messages, profile);
  return structuredClone(messages);
}

export function recordAppliedProposal(id: string, summary: ProposalSummary, change?: Message['noteChanges']): Message[] {
  const stored = readWorkspaceConversation(id, false);
  const messages = structuredClone(stored.messages);
  const message = messages.find(message => message.role === 'assistant' && message.editProposals?.some(proposal => proposal.id === summary.id));
  if (!message) throw new Error('提案对应的回答未保存，文件提交结果需手动检查');
  message.editProposals = message.editProposals!.map(proposal => proposal.id === summary.id ? { ...summary } : proposal);
  if (change?.length) message.noteChanges = [...(message.noteChanges ?? []).filter(old => !change.some(item => item.id === old.id)), ...change];
  saveConversationMessages(id, messages, stored.profile); return messages;
}

export function renameConversation(id: string, title: string): ConversationSummary {
  assertAvailable();
  const input = conversationRenameSchema.parse({ id, title });
  const item = conversations.find(item => item.id === input.id);
  if (!item) throw new Error('历史对话不存在或已被删除');
  const previous = { title: item.title, titleMode: item.titleMode };
  item.title = input.title; item.titleMode = 'manual';
  // Renaming does not reorder the conversation or alter an in-flight transcript.
  try { persist(); } catch (error) { Object.assign(item, previous); throw error; }
  return summaryOf(item);
}

export function deleteConversation(id: string): boolean {
  assertAvailable();
  const index = conversations.findIndex((conversation) => conversation.id === id);
  if (index < 0) throw new Error('历史对话不存在或已被删除');
  const [item] = conversations.splice(index, 1);
  try { persist(); }
  catch (error) { conversations.splice(index, 0, item); throw error; }
  if (item.capture) {
    const file = join(captures(), basename(item.capture.fileName));
    if (existsSync(file)) unlinkSync(file);
  }
  const retained = historyImageIds(); removeChatImages(item.messages.flatMap(message => message.images?.map(image => image.id) ?? []).filter(id => !retained.has(id)));
  return true;
}

export function clearConversations(): boolean {
  assertAvailable();
  const previous = conversations;
  conversations = [];
  try { persist(); }
  catch (error) { conversations = previous; throw error; }
  for (const item of previous) {
    if (item.capture) {
      const file = join(captures(), basename(item.capture.fileName));
      if (existsSync(file)) unlinkSync(file);
    }
    removeChatImages(item.messages.flatMap(message => message.images?.map(image => image.id) ?? []));
  }
  return previous.length > 0;
}
