import type { Result } from './contracts';

export type UpdateState = {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'error' | 'downloading' | 'downloaded' | 'installing';
  currentVersion: string;
  latestVersion: string | null;
  checkedAt: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  downloadSupported: boolean;
  downloadUnavailableReason: string | null;
  downloadProgress: number | null;
  error: string | null;
};

export type UpdatesAPI = {
  current(): Promise<Result<UpdateState>>;
  check(): Promise<Result<UpdateState>>;
  openRelease(): Promise<Result<void>>;
  download(): Promise<Result<UpdateState>>;
  restartAndInstall(): Promise<Result<UpdateState>>;
  onChanged(callback: (state: UpdateState) => void): () => void;
};
