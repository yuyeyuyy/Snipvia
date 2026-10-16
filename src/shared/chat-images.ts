import { z } from 'zod';
import type { Result } from './contracts';
import type { CapabilityStatus } from './models';

export const chatImageLimits = { perTurn: 4, sourceBytes: 10 * 1024 * 1024, storedBytes: 4 * 1024 * 1024, pixels: 20_000_000, edge: 2048, draftBytes: 64 * 1024 * 1024, requestBytes: 16 * 1024 * 1024, requestImages: 8 } as const;
export const chatImageSchema = z.strictObject({ id: z.string().uuid(), name: z.string().min(1).max(100), mimeType: z.literal('image/png'), width: z.number().int().positive().max(chatImageLimits.edge), height: z.number().int().positive().max(chatImageLimits.edge), bytes: z.number().int().positive().max(chatImageLimits.storedBytes) });
export type ChatImage = z.infer<typeof chatImageSchema>;
export const chatImageIdsSchema = z.array(z.string().uuid()).max(chatImageLimits.perTurn).refine(ids => new Set(ids).size === ids.length, '图片不能重复');
export const chatImageScopeSchema = z.strictObject({ conversationId: z.string().uuid().nullable() });
export const chatImageImportSchema = chatImageScopeSchema.extend({ files: z.array(z.strictObject({ name: z.string().min(1).max(255), bytes: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= chatImageLimits.sourceBytes, '图片需小于 10 MiB') })).min(1).max(chatImageLimits.perTurn) });
export const chatImageReferenceSchema = chatImageScopeSchema.extend({ imageId: z.string().uuid() });
export const chatImageCaptureSchema = chatImageScopeSchema.extend({ sourceConversationId: z.string().uuid() });
export const chatImageBindSchema = z.strictObject({ conversationId: z.string().uuid(), imageIds: chatImageIdsSchema });
export interface ChatImagesAPI {
  sources(): Promise<Result<Array<{ id: string; title: string; createdAt: string }>>>;
  choose(conversationId: string | null): Promise<Result<ChatImage[]>>;
  import(conversationId: string | null, files: Array<{ name: string; bytes: Uint8Array }>): Promise<Result<ChatImage[]>>;
  paste(conversationId: string | null): Promise<Result<ChatImage[]>>;
  fromCapture(conversationId: string | null, sourceConversationId: string): Promise<Result<ChatImage[]>>;
  preview(conversationId: string | null, imageId: string): Promise<Result<{ bytes: Uint8Array; mimeType: 'image/png' }>>;
  remove(conversationId: string | null, imageId: string): Promise<Result<void>>;
  bind(conversationId: string, imageIds: string[]): Promise<Result<void>>;
  capability(): Promise<Result<CapabilityStatus>>;
}
