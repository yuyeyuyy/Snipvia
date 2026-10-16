import { z } from 'zod';
import type { Result } from '../contracts';
import { agentNotePathSchema } from './note-writing';
import { predictionTriggerSchema, screenshotActionIdSchema } from '../screenshot-understanding';

export const editingContextSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('note'), notebookId: z.string().uuid(), path: agentNotePathSchema.nullable(), version: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  z.strictObject({ kind: z.literal('branches'), branchIds: z.array(screenshotActionIdSchema).max(30).refine(ids => new Set(ids).size === ids.length, '分支不能重复') })
]);
export type EditingContextRequest = z.infer<typeof editingContextSchema>;
export type EditingContextView = { id: string; kind: 'note' | 'branches'; label: string; request: EditingContextRequest };
const content = z.string().max(256 * 1024);
const patch = z.strictObject({
  label: z.string().trim().min(1).max(40).optional(), runningLabel: z.string().trim().min(1).max(60).optional(),
  applicableContent: z.string().trim().min(1).max(1000).optional(), prompt: z.string().trim().max(4000).optional(),
  enabled: z.boolean().optional(), notebookId: z.string().uuid().nullable().optional()
}).refine(value => Object.keys(value).length > 0, '没有需要修改的字段');
export const branchOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('create'), branch: z.strictObject({
    label: z.string().trim().min(1).max(40), runningLabel: z.string().trim().min(1).max(60), trigger: predictionTriggerSchema,
    prompt: z.string().trim().min(1).max(4000), applicableContent: z.string().trim().min(1).max(1000).optional(),
    enabled: z.boolean(), notebookId: z.string().uuid().nullable().optional()
  }), position: z.number().int().min(0).max(30).optional() }),
  z.strictObject({ op: z.literal('update'), id: screenshotActionIdSchema, patch }),
  z.strictObject({ op: z.literal('remove'), id: screenshotActionIdSchema }),
  z.strictObject({ op: z.literal('reorder'), ids: z.array(screenshotActionIdSchema).max(30) })
]);
export const branchOperationsSchema = z.array(branchOperationSchema).min(1).max(30);
export type BranchOperation = z.infer<typeof branchOperationSchema>;
export const noteProposalInputSchema = z.discriminatedUnion('mode', [
  z.strictObject({ path: agentNotePathSchema, mode: z.literal('create'), content: content.min(1) }),
  z.strictObject({ path: agentNotePathSchema, mode: z.literal('replace'), content }),
  z.strictObject({ path: agentNotePathSchema, mode: z.literal('append'), content: content.min(1) }),
  z.strictObject({ path: agentNotePathSchema, mode: z.literal('edit'), edits: z.array(z.strictObject({ search: content.min(1), replace: content })).min(1).max(20) })
]);
export type NoteProposalInput = z.infer<typeof noteProposalInputSchema>;
export type EditingIntent = { kind: 'read'; offset?: number } | { kind: 'note'; change: NoteProposalInput } | { kind: 'branches'; operations: BranchOperation[] };
export type ProposalStatus = 'generating' | 'pending' | 'applying' | 'applied' | 'cancelled' | 'expired';
export const proposalSummarySchema = z.strictObject({ id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(['note', 'branches']), title: z.string().min(1).max(1024), status: z.enum(['generating', 'pending', 'applying', 'applied', 'cancelled', 'expired']), added: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), message: z.string().max(1000).optional(), note: z.strictObject({ notebookId: z.string().uuid(), path: agentNotePathSchema }).optional() });
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;
export type ProposalPreview = ProposalSummary & { before: string; after: string; diff: string };
export type EditingSnapshot = { revision: number; context: EditingContextView | null; proposals: ProposalSummary[] };
export const editingReferenceSchema = z.strictObject({ conversationId: z.string().uuid() });
export const editingSelectionSchema = editingReferenceSchema.extend({ context: editingContextSchema.nullable() });
export const editingProposalSchema = editingReferenceSchema.extend({ proposalId: z.string().uuid() });
export const editingApplySchema = editingProposalSchema.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/) });
export interface EditingAPI {
  state(conversationId: string): Promise<Result<EditingSnapshot>>;
  select(conversationId: string, context: EditingContextRequest | null): Promise<Result<EditingSnapshot>>;
  preview(conversationId: string, proposalId: string): Promise<Result<ProposalPreview>>;
  apply(conversationId: string, proposalId: string, digest: string): Promise<Result<ProposalSummary>>;
  cancel(conversationId: string, proposalId: string): Promise<Result<ProposalSummary>>;
  openNote(conversationId: string, proposalId: string): Promise<Result<void>>;
  onChanged(callback: (value: { conversationId: string; snapshot: EditingSnapshot }) => void): () => void;
}
