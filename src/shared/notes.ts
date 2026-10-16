import { z } from 'zod';
import type { Result } from './contracts';

export type Notebook = { id: string; name: string; directory: string };
export type NotebookReference = Pick<Notebook, 'id' | 'name'>;
export type NoteCreationRequest = { id: string; captureId?: string };
export type NoteOpenRequest = { id: string; notebookId: string; path: string };
export type NoteEntry = { path: string; name: string; kind: 'folder' | 'note' | 'asset'; modifiedAt: number; createdAt: number; size: number };
export type NoteDocument = { path: string; content: string; version: string };
export type NotesState = { notebooks: Notebook[]; activeId: string | null };
export type NoteBacklink = { path: string; name: string; excerpt: string };
export type NoteAsset = { path: string; image: boolean };
export type NoteSaveResult = { conflict: false; document: NoteDocument } | { conflict: true; current: NoteDocument };
const hasControl = (text: string) => [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export const notebookIdSchema = z.string().uuid();
export const notePathSchema = z.string().min(1).max(1024).refine((path) => !path.startsWith('/') && !path.includes('\\') &&
  !hasControl(path) && path.split('/').every((part) => !!part && part !== '.' && part !== '..' && !part.startsWith('.') && !/[<>:"|?*]/.test(part)), '文件路径无效');
export const noteNameSchema = z.string().trim().min(1).max(100).refine((name) => !hasControl(name) && !/[<>:"/\\|?*#^[\]]/.test(name) &&
  !name.startsWith('.') && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name), '名称包含不支持的字符');
export const noteFileSchema = z.strictObject({ notebookId: notebookIdSchema, path: notePathSchema });
export const noteSaveSchema = noteFileSchema.extend({ content: z.string().max(2 * 1024 * 1024), version: z.string().regex(/^[a-f0-9]{64}$/) });
export const noteCreateSchema = z.strictObject({ notebookId: notebookIdSchema, parent: z.union([z.literal(''), notePathSchema]), name: noteNameSchema, kind: z.enum(['folder', 'note']) });
export const noteMoveSchema = noteFileSchema.extend({ destination: notePathSchema });
export const noteAssetSchema = z.strictObject({ notebookId: notebookIdSchema, name: z.string().min(1).max(255), bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.length > 0 && bytes.length <= 25 * 1024 * 1024, '附件最多 25 MB') });

export interface NotesAPI {
  copyCode(content: string): Promise<Result<void>>;
  requestCreation(captureId?: string): Promise<Result<void>>;
  onCreationRequested(callback: (request: NoteCreationRequest) => void): () => void;
  onOpenRequested(callback: (request: NoteOpenRequest) => void): () => void;
  state(): Promise<Result<NotesState>>;
  chooseLocation(): Promise<Result<{ token: string; directory: string } | null>>;
  create(token: string, name: string): Promise<Result<Notebook>>;
  open(): Promise<Result<Notebook | null>>;
  select(notebookId: string): Promise<Result<Notebook>>;
  unlink(notebookId: string): Promise<Result<NotesState>>;
  entries(notebookId: string): Promise<Result<NoteEntry[]>>;
  read(notebookId: string, path: string): Promise<Result<NoteDocument>>;
  save(notebookId: string, document: NoteDocument): Promise<Result<NoteSaveResult>>;
  createEntry(notebookId: string, parent: string, name: string, kind: 'folder' | 'note'): Promise<Result<string>>;
  move(notebookId: string, path: string, destination: string): Promise<Result<void>>;
  trash(notebookId: string, path: string): Promise<Result<void>>;
  backlinks(notebookId: string, path: string): Promise<Result<NoteBacklink[]>>;
  importAssets(notebookId: string): Promise<Result<NoteAsset[]>>;
  addAsset(notebookId: string, name: string, bytes: Uint8Array): Promise<Result<NoteAsset>>;
  image(notebookId: string, path: string): Promise<Result<string | null>>;
  reveal(notebookId: string, path: string): Promise<Result<void>>;
  export(notebookId: string): Promise<Result<string | null>>;
  onChanged(callback: (notebookId: string) => void): () => void;
  onFlushRequest(callback: (requestId: string) => void): () => void;
  finishFlush(requestId: string, success: boolean): Promise<Result<void>>;
}
