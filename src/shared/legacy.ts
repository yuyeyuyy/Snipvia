import type { Result } from './contracts';
export type LegacyRecord = { id: string; title: string; createdAt: string; detail: string };
export type LegacySnapshot = { conversations: LegacyRecord[]; schedule: LegacyRecord[]; notebooks: Array<{ id: string; name: string; directory: string }>; errors: string[] };
export type LegacyAPI = {
  read(): Promise<Result<LegacySnapshot>>;
  export(): Promise<Result<boolean>>;
  importScreenshots(): Promise<Result<{ imported: number; existing: number; errors: string[] }>>;
  revealNotebook(id: string): Promise<Result<void>>;
};
