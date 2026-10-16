import { describe, expect, it } from 'vitest';
import { selectDesktopScreenSource } from '../../src/main/capture/desktop-source-selection';

const selected = { id: 'screen:1:0', display_id: '42' };
const other = { id: 'screen:0:0', display_id: '17' };

describe('selectDesktopScreenSource', () => {
  it('matches the requested display ID before any Windows fallback', () => {
    expect(selectDesktopScreenSource([other, selected], '42', 'win32', 2)).toBe(selected);
  });

  it('uses the only source on a single-display Windows system when Electron omits display_id', () => {
    const source = { id: 'screen:0:0', display_id: '' };
    expect(selectDesktopScreenSource([source], '42', 'win32', 1)).toBe(source);
  });

  it('does not guess the source for multiple Windows displays', () => {
    const sources = [{ id: 'screen:0:0', display_id: '' }, { id: 'screen:1:0', display_id: '' }];
    expect(selectDesktopScreenSource(sources, '42', 'win32', 2)).toBeUndefined();
  });

  it('does not change macOS source selection', () => {
    expect(selectDesktopScreenSource([{ id: 'screen:0:0', display_id: '' }], '42', 'darwin', 1)).toBeUndefined();
  });
});
