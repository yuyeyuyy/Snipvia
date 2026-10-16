import { z } from 'zod';
import { notePathSchema } from '../notes';

export const agentNotePathSchema = notePathSchema.refine(path => /\.md$/i.test(path) && path.split('/')[0].toLowerCase() !== 'assets', '仅可写入笔记本中的 Markdown 笔记');
export const noteChangeSchema = z.strictObject({
  id: z.string().uuid(), notebookId: z.string().uuid(), notebookName: z.string().min(1).max(100),
  path: agentNotePathSchema, operation: z.enum(['create', 'edit', 'move', 'delete']), previousPath: agentNotePathSchema.optional(),
  added: z.number().int().min(0), removed: z.number().int().min(0)
});
export type NoteChangeSummary = z.infer<typeof noteChangeSchema>;
export const noteChangesSchema = z.array(noteChangeSchema).max(100);
export type NoteChangeIntent = { path: string } & (
  { kind: 'create' | 'append'; content: string } |
  { kind: 'edit'; edits: Array<{ search: string; replace: string }> }
);
