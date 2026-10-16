export type NoteIconName = 'new' | 'folder' | 'sort' | 'reveal' | 'collapse' | 'export' | 'attach' | 'outline' | 'read' | 'source' | 'edit' | 'more' | 'back' | 'refresh' | 'link' | 'switch' | 'chevron' | 'files-panel' | 'outline-panel' | 'unlink' | 'file' | 'directory';
export function NoteIcon({ name, size = 17 }: { name: NoteIconName; size?: number }) {
  const paths: Record<NoteIconName, React.ReactNode> = {
    new: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M14 3l4 4M9 16l1-5L18 3l3 3-8 8z" /></>,
    folder: <><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3zM12 10v6M9 13h6" /></>,
    directory: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3z" />,
    file: <><path d="M14 3H5v18h14V8zM14 3v5h5" /></>,
    sort: <><path d="M5 20V4M2 7l3-3 3 3M12 7h3M12 12h6M12 17h9" /></>,
    reveal: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M4 2h16M4 22h16" /></>,
    collapse: <><path d="m7 4 5 5 5-5M7 20l5-5 5 5" /></>,
    export: <><path d="M12 3v12M7 10l5 5 5-5M4 15v5h16v-5" /></>,
    attach: <path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9M8 15l8-8" />,
    outline: <><path d="M9 5h12M9 12h12M9 19h12M3 4l2 1-2 1M3 11l2 1-2 1M3 18l2 1-2 1" /></>,
    read: <><path d="M12 6c-3-3-7-3-10-2v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2zM12 6v15" /></>,
    source: <><path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18" /></>,
    edit: <><path d="m4 16 1 5 5-1L21 9l-6-6L4 16zM12 6l6 6" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    back: <path d="m14 5-7 7 7 7" />,
    switch: <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    'files-panel': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    'outline-panel': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
    unlink: <><path d="m9 6 2-2a5 5 0 0 1 7 7l-1 1M7 12l-1 1a5 5 0 0 0 7 7l2-2M3 3l18 18" /></>,
    refresh: <><path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6" /></>,
    link: <><path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8" /></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
