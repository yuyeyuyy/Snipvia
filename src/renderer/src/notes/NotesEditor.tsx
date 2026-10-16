import { useEffect, useRef, type MutableRefObject } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { livePreview } from './live-preview';
import { noteCodeLanguages } from './code-language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { noteLinks, noteHeadings } from '../../../shared/note-markdown';

export type NoteEditorHandle = { insert(text: string): void; jump(from: number): void; format(before: string, after?: string): void; focus(): void };
type EditorProps = { value: string; mode: 'live' | 'source'; notebookId: string; path: string; paths: string[]; onChange(value: string): void;
  onLink(target: string, wiki: boolean): void; onFiles(files: File[]): Promise<string>; onSave(): void; toggleReading(): void; editorRef: MutableRefObject<NoteEditorHandle | null> };

export function NotesEditor(props: EditorProps) {
  const element = useRef<HTMLDivElement>(null); const view = useRef<EditorView | null>(null); const current = useRef(props); current.current = props;
  const preview = useRef(new Compartment());
  useEffect(() => {
    const format = (before: string, after = before) => {
      const editor = view.current; if (!editor) return;
      const selection = editor.state.selection.main; const text = editor.state.sliceDoc(selection.from, selection.to);
      editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: `${before}${text}${after}` },
        selection: { anchor: selection.from + before.length, head: selection.from + before.length + text.length } }); editor.focus();
    };
    const editor = new EditorView({ parent: element.current!, state: EditorState.create({ doc: props.value, extensions: [
      history(), markdown({ base: markdownLanguage, codeLanguages: noteCodeLanguages }), syntaxHighlighting(classHighlighter), EditorView.lineWrapping, highlightSelectionMatches(),
      placeholder('写下第一行，或输入 [[ 链接另一篇笔记…'),
      EditorView.contentAttributes.of({ 'aria-label': '笔记编辑器', spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-s', run: () => { current.current.onSave(); return true; } },
        { key: 'Mod-e', run: () => { current.current.toggleReading(); return true; } },
        { key: 'Mod-b', run: () => { format('**'); return true; } }, { key: 'Mod-i', run: () => { format('*'); return true; } },
        ...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      autocompletion({ override: [(context) => {
        const match = context.matchBefore(/\[\[[^\]\n]*/); if (!match) return null;
        const typed = match.text.slice(2); const options = typed.startsWith('#') ? noteHeadings(context.state.doc.toString()).map((heading) => `#${heading.text}`)
          : current.current.paths.filter((path) => /\.md$/i.test(path)).map((path) => path.replace(/\.md$/i, ''));
        return { from: match.from + 2, options: options.map((label) => ({ label, type: 'text', apply: (editor: EditorView, _completion: unknown, from: number, to: number) => {
          const closed = editor.state.sliceDoc(to, to + 2) === ']]'; editor.dispatch({ changes: { from, to: to + (closed ? 2 : 0), insert: `${label}]]` } });
        } })) };
      }] }),
      preview.current.of(props.mode === 'live' ? livePreview(current) : []),
      EditorView.updateListener.of((update) => { if (update.docChanged) current.current.onChange(update.state.doc.toString()); }),
      EditorView.domEventHandlers({
        click: (event, editor) => {
          if (!event.metaKey && !event.ctrlKey) return false;
          const position = editor.posAtCoords({ x: event.clientX, y: event.clientY }); if (position === null) return false;
          const link = noteLinks(editor.state.doc.toString()).find((item) => item.from <= position && position <= item.to);
          if (!link) return false; current.current.onLink(link.target, link.wiki); return true;
        },
        paste: (event) => {
          const files = [...(event.clipboardData?.files ?? [])]; if (!files.length) return false;
          event.preventDefault(); void current.current.onFiles(files).then((text) => { if (view.current === editor && text) editor.dispatch(editor.state.replaceSelection(text)); }); return true;
        },
        drop: (event) => {
          const notePath = event.dataTransfer?.getData('application/x-snipvia-note');
          const files = [...(event.dataTransfer?.files ?? [])]; if (!files.length && !notePath) return false;
          event.preventDefault();
          if (notePath) editor.dispatch(editor.state.replaceSelection(`[[${notePath.replace(/\.md$/i, '')}]]`));
          else void current.current.onFiles(files).then((text) => { if (view.current === editor && text) editor.dispatch(editor.state.replaceSelection(text)); });
          return true;
        }
      })
    ] }) });
    view.current = editor;
    editor.focus();
    props.editorRef.current = { insert: (text) => { editor.dispatch(editor.state.replaceSelection(text)); editor.focus(); },
      jump: (from) => { const position = Math.min(from, editor.state.doc.length); editor.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 20 }) }); editor.focus(); },
      format, focus: () => editor.focus() };
    return () => { props.editorRef.current = null; view.current = null; editor.destroy(); };
  }, [props.notebookId, props.path]);
  useEffect(() => { view.current?.dispatch({ effects: preview.current.reconfigure(props.mode === 'live' ? livePreview(current) : []) }); }, [props.mode]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.value }, selection: { anchor: Math.min(editor.state.selection.main.head, props.value.length) } });
  }, [props.value]);
  return <div className="note-editor" ref={element} />;
}
