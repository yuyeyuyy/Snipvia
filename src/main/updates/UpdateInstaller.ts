export interface UpdateInstaller {
  supported: boolean;
  unavailableReason: string | null;
  download(version: string, tag: string, progress: (percent: number) => void): Promise<void>;
  install(): void;
  dispose(): void;
}
