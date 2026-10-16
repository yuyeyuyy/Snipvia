import { useRef, useState } from 'react';
import type { NoteDocument } from '../../../shared/notes';

const editable = (content: string) => content.replace(/^\ufeff/, '').replace(/\r\n/g, '\n');
type Draft = { notebookId: string; path: string; content: string; saved: string; version: string; conflict?: NoteDocument };
/** Serial saves and flush-before-navigation keep edits made during an in-flight save. */
export function useNoteDocument(onError: (message: string) => void) {
  const current = useRef<Draft | null>(null); const pending = useRef<Promise<boolean> | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [revision, render] = useState(0); const [saving, setSaving] = useState(false);
  const update = () => render((value) => value + 1);
  async function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    if (pending.current) return pending.current;
    if (!current.current || current.current.content === current.current.saved) return true;
    if (current.current.conflict) return false;
    const work = async () => {
      setSaving(true);
      try {
        while (current.current && current.current.content !== current.current.saved) {
          const draft = current.current; const sent = draft.content;
          const result = await window.snipvia.notes.save(draft.notebookId, { path: draft.path, version: draft.version, content: sent });
          if (!result.ok) throw new Error(result.error);
          if (result.value.conflict) { draft.conflict = result.value.current; update(); return false; }
          draft.version = result.value.document.version; draft.saved = editable(result.value.document.content);
          if (draft.content === sent) draft.content = draft.saved;
          update();
        }
        return true;
      } catch (error) { onError(error instanceof Error ? error.message : '保存失败，编辑内容已保留'); return false; }
      finally { setSaving(false); pending.current = null; }
    };
    pending.current = work(); return pending.current;
  }
  return { draft: current.current, saving, revision, flush,
    get: () => current.current,
    edit(content: string) { const draft = current.current; if (!draft || draft.content === content) return; draft.content = content; update(); clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, 400); },
    load(notebookId: string, document: NoteDocument) { clearTimeout(timer.current); current.current = { notebookId, path: document.path, content: editable(document.content), saved: editable(document.content), version: document.version }; update(); },
    clear() { clearTimeout(timer.current); current.current = null; update(); },
    acceptDisk() { const draft = current.current; if (!draft?.conflict) return; draft.content = editable(draft.conflict.content); draft.saved = draft.content; draft.version = draft.conflict.version; draft.conflict = undefined; update(); }
  };
}
