import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button } from '../components/ui/Button';
import { acceleratorFromKeyboardEvent, formatAccelerator, isModifierKey } from './shortcut';
export function ShortcutRecorder({ label, value, disabled, onCommit, onInvalid }: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit(value: string): Promise<boolean>;
  onInvalid(message: string): void;
}) {
  const [recording, setRecording] = useState(false);

  function keyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { setRecording(false); return; }
    if (isModifierKey(event.key)) return;
    const accelerator = acceleratorFromKeyboardEvent(event.nativeEvent, window.snipvia.platform);
    if (!accelerator) {
      onInvalid('请按下修饰键与字母、数字或功能键的组合');
      return;
    }
    setRecording(false);
    void onCommit(accelerator);
  }

  return <Button
    type="button"
    className={`shortcut-recorder ${recording ? 'recording' : ''}`}
    aria-label={label}
    aria-pressed={recording}
    disabled={disabled}
    onClick={() => setRecording(true)}
    onBlur={() => setRecording(false)}
    onKeyDown={keyDown}
  >
    <kbd>{recording ? '按下组合键…' : formatAccelerator(value, window.snipvia.platform)}</kbd>
  </Button>;
}

