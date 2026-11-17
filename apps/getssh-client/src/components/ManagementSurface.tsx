import type { ReactNode } from 'react';
import './ManagementSurface.css';

export function ManagementHeader({ context, title, description, actions, compact = false }: {
  context?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={`management-header center-page-header${compact ? ' management-header--compact' : ''}`}>
      <div className="management-heading">
        {context && <p className="management-context">{context}</p>}
        <h1>{title}</h1>
        {description && <p className="management-description">{description}</p>}
      </div>
      {actions && <div className="management-actions">{actions}</div>}
    </header>
  );
}
