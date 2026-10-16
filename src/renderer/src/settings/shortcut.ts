type ShortcutEvent = Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>;

const modifierKeys = new Set(['Alt', 'Control', 'Meta', 'Shift']);

export function isModifierKey(key: string) {
  return modifierKeys.has(key);
}

function mainKey(event: ShortcutEvent) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key.toUpperCase();
  const named: Record<string, string> = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Backspace: 'Backspace', Delete: 'Delete', Enter: 'Enter', Home: 'Home', End: 'End',
    Insert: 'Insert', PageUp: 'PageUp', PageDown: 'PageDown', Tab: 'Tab'
  };
  return named[event.key] ?? null;
}

export function acceleratorFromKeyboardEvent(event: ShortcutEvent, platform: string = 'darwin') {
  if (isModifierKey(event.key)) return null;
  if (platform === 'win32' && event.metaKey) return null;
  const key = mainKey(event);
  if (!key) return null;
  const modifiers: string[] = [];
  if (event.metaKey || (platform === 'win32' && event.ctrlKey)) modifiers.push('CommandOrControl');
  if (event.ctrlKey && platform !== 'win32') modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0 && !/^F\d+$/.test(key)) return null;
  return [...modifiers, key].join('+');
}

export function formatAccelerator(accelerator: string, platform: string = 'darwin') {
  if (platform === 'win32') {
    return accelerator
      .replaceAll('CommandOrControl', 'Ctrl')
      .replaceAll('Command', 'Win')
      .replaceAll('Control', 'Ctrl')
      .replaceAll('Option', 'Alt')
      .split('+')
      .join(' + ');
  }
  return accelerator
    .replaceAll('CommandOrControl', '⌘')
    .replaceAll('Command', '⌘')
    .replaceAll('Control', '⌃')
    .replaceAll('Option', '⌥')
    .replaceAll('Alt', '⌥')
    .replaceAll('Shift', '⇧')
    .split('+')
    .join(' ');
}
