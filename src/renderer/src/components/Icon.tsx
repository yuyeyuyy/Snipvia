export type IconName = 'copy' | 'more' | 'edit' | 'brand' | 'refresh' | 'chat' | 'capture' | 'calendar' | 'history' | 'settings' | 'image' | 'arrow' | 'arrowUp' | 'stop' | 'plus' | 'close' | 'chevron' | 'info' | 'notebook' | 'user' | 'sidebar' | 'search';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    // Reuse the tray template silhouette; real application artwork stays unchanged.
    brand: <><path d="M19 7.75A4.5 4.5 0 0 1 22 12v5.5a4.5 4.5 0 0 1-4.5 4.5H12a4.5 4.5 0 0 1-4.25-3" /><path fill="currentColor" fillRule="evenodd" stroke="none" d="M7 2h5a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z M9.5 5c.4 2.7 1.8 4.1 4.5 4.5-2.7.4-4.1 1.8-4.5 4.5-.4-2.7-1.8-4.1-4.5-4.5 2.7-.4 4.1-1.8 4.5-4.5Z" /></>,
    copy: <><rect x='8' y='8' width='12' height='13' rx='2' /><path d='M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' /></>,
    more: <><circle cx='5' cy='12' r='1' /><circle cx='12' cy='12' r='1' /><circle cx='19' cy='12' r='1' /></>,
    edit: <><path d='M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M17 3l4 4-10 10-5 1 1-5Z' /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></>,
    refresh: <><path d="M20 5v5h-5M4 19v-5h5" /><path d="M5.5 8a7.5 7.5 0 0 1 12.3-2.3L20 10M4 14l2.2 4.3A7.5 7.5 0 0 0 18.5 16" /></>,
    user: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><circle cx="12" cy="9" r="2.5" /><path d="M7.5 17.5a4.5 4.5 0 0 1 9 0" /></>,
    sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 4.5v15" /></>,
    notebook: <><path d="M5 3.5h12a2 2 0 0 1 2 2v15H7a3 3 0 0 1-3-3v-12a2 2 0 0 1 1-2zM4 17.5a2 2 0 0 1 2-2h13M8 4v11M11 7h5M11 10h4" /></>,
    chat: <path d="M5 4.5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" />,
    capture: <><path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" /><path d="M8 12h8M12 8v8" /></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17M8 13h3M8 16.5h3" /></>,
    history: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5l3.2 1.8" /></>,
    settings: <><path d="M9.83 5.13 10.64 2.9h2.72l.81 2.23 1.15.48 2.15-1.01 1.93 1.93-1.01 2.15.48 1.15 2.23.81v2.72l-2.23.81-.48 1.15 1.01 2.15-1.93 1.93-2.15-1.01-1.15.48-.81 2.23h-2.72l-.81-2.23-1.15-.48-2.15 1.01-1.93-1.93 1.01-2.15-.48-1.15-2.23-.81v-2.72l2.23-.81.48-1.15-1.01-2.15 1.93-1.93 2.15 1.01z" /><circle cx="12" cy="12" r="3" /></>,
    image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="8.5" cy="9" r="1.3" /><path d="m4 17 5-4 3 2 3.5-4 4.5 4.5" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    arrowUp: <path d="M12 20V4M5 11l7-7 7 7" />,
    stop: <rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" />,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    close: <><path d="M6 6l12 12M18 6 6 18" /></>,
    chevron: <><path d="m9 6 6 6-6 6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 7.2v6" /><path d="M12 16.7h.01" /></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
