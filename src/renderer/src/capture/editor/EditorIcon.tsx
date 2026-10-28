import type { EditorTool } from './model';
export type EditorIconName = EditorTool | 'undo' | 'redo' | 'pin' | 'save' | 'copy' | 'close';
const paths: Record<EditorIconName, React.ReactNode> = {
  select: <path d="m5 3 14 10-7 1-3 7Z" />,
  rectangle: <rect x="4" y="5" width="16" height="14" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="7" />,
  arrow: <path d="M5 19 19 5M8 5h11v11" />,
  pencil: <><path d="m4 16 12-12 4 4L8 20l-5 1Z" /><path d="m13 7 4 4" /></>,
  text: <path d="M4 5h16M12 5v15M8 20h8" />,
  number: <><circle cx="12" cy="12" r="9" /><path d="m10 9 2-2v10m-3 0h6" /></>,
  mosaic: <><path d="M3 3h6v6H3zm12 0h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zm12 0h6v6h-6z" fill="currentColor" stroke="none" /></>,
  erase: <><path d="m3 14 10-11 8 8-9 10H9Z" /><path d="m7 10 8 8m-3 3h9" /></>,
  undo: <path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14" />,
  redo: <path d="m16 4 5 5-5 5m5-5h-10a7 7 0 0 0 0 14" />,
  pin: <path d="m9 3 12 12-4 1-3 5-4-4-6 5 5-6-4-4 5-3Z" />,
  save: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />
};
export function EditorIcon({ name }: { name: EditorIconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
