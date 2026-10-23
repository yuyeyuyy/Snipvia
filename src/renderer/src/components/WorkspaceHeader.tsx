import type { ReactNode } from 'react';
export function WorkspaceHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <header className="workspace-header"><h1>{title}</h1><div>{children}</div></header>;
}
