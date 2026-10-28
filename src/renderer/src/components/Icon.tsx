export type IconName = 'pin' | 'width' | 'copy' | 'brand' | 'arrow' | 'info' | 'trash' | 'merge' | 'export' | 'select' | 'check' | 'resize' | 'more' | 'collapse' | 'expand' | 'close' | 'back';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    // Reuse the tray template silhouette; real application artwork stays unchanged.
    brand: <><path d="M19 7.75A4.5 4.5 0 0 1 22 12v5.5a4.5 4.5 0 0 1-4.5 4.5H12a4.5 4.5 0 0 1-4.25-3" /><path fill="currentColor" fillRule="evenodd" stroke="none" d="M7 2h5a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z M9.5 5c.4 2.7 1.8 4.1 4.5 4.5-2.7.4-4.1 1.8-4.5 4.5-.4-2.7-1.8-4.1-4.5-4.5 2.7-.4 4.1-1.8 4.5-4.5Z" /></>,
    pin: <><path d="m8 3 8 2-2 5 3 4-6-1-3 4-1-6-4-3 5-1Z" /><path d="m8 16-4 5" /></>,
    width: <><path d="M3 5v14M21 5v14M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3" /></>,
    copy: <><rect x='8' y='8' width='12' height='13' rx='2' /><path d='M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></>,
    merge: <><rect x="5" y="3" width="14" height="7" rx="2" /><rect x="5" y="14" width="14" height="7" rx="2" /><path d="M9 12h6" /></>,
    export: <><path d="M12 3v12M8 11l4 4 4-4M5 15v5h14v-5" /></>,
    select: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8 12 3 3 5-6" /></>,
    check: <path d="m5 12 4 4 10-10" />,
    resize: <><path d="M5 9V5h4M15 19h4v-4M5 19l6-6M5 14v5h5M19 5l-6 6" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    collapse: <path d="m6 9 6 6 6-6" />,
    expand: <path d="m6 15 6-6 6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 7.2v6" /><path d="M12 16.7h.01" /></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
