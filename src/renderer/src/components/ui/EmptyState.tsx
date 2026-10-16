import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';

export function EmptyState({ icon, title, description, children }: { icon: IconName; title: string; description: string; children?: ReactNode }) {
  return <div className="ui-empty-state"><Icon name={icon} size={24} /><strong>{title}</strong><p>{description}</p>{children}</div>;
}
