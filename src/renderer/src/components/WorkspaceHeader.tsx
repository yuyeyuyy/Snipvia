import type { ReactNode } from 'react';

export function WorkspaceHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className="workspace-heading">
    <h1>{title}</h1>
    {children && <div className="workspace-heading-actions">{children}</div>}
  </div>;
}
