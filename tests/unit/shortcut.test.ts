import { captureShortcutKeys, defaultCapturePreferences } from '../../src/shared/capture-preferences';
import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyboardEvent, formatAccelerator } from '../../src/renderer/src/settings/shortcut';

function keyboardEvent(value: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: '',
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...value
  } as KeyboardEvent;
}

describe('shortcut recording', () => {
  it('normalizes a pressed macOS key combination for Electron', () => {
    expect(acceleratorFromKeyboardEvent(keyboardEvent({ code: 'KeyK', key: 'K', metaKey: true, shiftKey: true })))
      .toBe('CommandOrControl+Shift+K');
    expect(formatAccelerator('CommandOrControl+Shift+K')).toBe('⌘ ⇧ K');
  });

  it('uses the physical digit key and rejects ordinary unmodified typing', () => {
    expect(acceleratorFromKeyboardEvent(keyboardEvent({ code: 'Digit9', key: '(', metaKey: true, shiftKey: true })))
      .toBe('CommandOrControl+Shift+9');
    expect(acceleratorFromKeyboardEvent(keyboardEvent({ code: 'KeyK', key: 'k' }))).toBeNull();
  });

  it('allows function keys without a modifier', () => {
    expect(acceleratorFromKeyboardEvent(keyboardEvent({ code: 'F10', key: 'F10' }))).toBe('F10');
  });

  it('records and displays Windows Ctrl shortcuts without macOS symbols', () => {
    expect(acceleratorFromKeyboardEvent(keyboardEvent({ code: 'KeyK', key: 'k', ctrlKey: true, shiftKey: true }), 'win32'))
      .toBe('CommandOrControl+Shift+K');
    expect(formatAccelerator('CommandOrControl+Shift+K', 'win32')).toBe('Ctrl + Shift + K');
    expect(acceleratorFromKeyboardEvent(keyboardEvent({ code: 'KeyK', key: 'k', metaKey: true }), 'win32')).toBeNull();
  });
});


it('displays the same five defaults as Command on macOS and Ctrl on Windows', () => {
  expect(captureShortcutKeys.map(key => formatAccelerator(defaultCapturePreferences[key], 'darwin'))).toEqual(['⌘ 1', '⌘ 2', '⌘ 3', '⌘ 4', '⌘ 5']);
  expect(captureShortcutKeys.map(key => formatAccelerator(defaultCapturePreferences[key], 'win32'))).toEqual(['Ctrl + 1', 'Ctrl + 2', 'Ctrl + 3', 'Ctrl + 4', 'Ctrl + 5']);
});
