type DesktopScreenSource = {
  id: string;
  display_id: string;
};

export function selectDesktopScreenSource<T extends DesktopScreenSource>(
  sources: readonly T[],
  displayId: string,
  platform: NodeJS.Platform,
  displayCount: number
): T | undefined {
  const exact = sources.find((source) => source.display_id === displayId);
  if (exact) return exact;

  // Electron can return an empty display_id on Windows when its screen capturer
  // falls back from DirectX. A sole source is unambiguous only with one display.
  if (platform === 'win32' && displayCount === 1 && sources.length === 1) {
    return sources[0];
  }

  return undefined;
}
