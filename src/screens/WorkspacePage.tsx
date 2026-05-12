import { ArrowUpRight, Plus } from 'lucide-react';
import Link from 'next/link';

import { Button, Card, EmptyState } from '../components/ui';
import type { WorkspaceMetric, WorkspaceRow } from '../types/trading';
import { cn } from '../utils/classNames';

type WorkspacePageProps = {
  actionHref?: string;
  actionLabel?: string;
  eyebrow: string;
  metrics?: WorkspaceMetric[];
  rows?: WorkspaceRow[];
  title: string;
};

export function WorkspacePage({ actionHref, actionLabel = 'New', eyebrow, metrics = [], rows = [], title }: WorkspacePageProps) {
  return (
    <section className="workspace-page" aria-label={`${title} workspace`}>
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        {actionHref ? (
          <Link className="ui-button ui-button--primary ui-button--sm" href={actionHref}>
            <span className="ui-button__icon">
              <Plus size={16} />
            </span>
            <span>{actionLabel}</span>
          </Link>
        ) : (
          <Button icon={<Plus size={16} />} size="sm" variant="primary">
            {actionLabel}
          </Button>
        )}
      </div>

      <div className="workspace-summary-grid">
        {metrics.map((metric) => (
          <Card className="workspace-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong className={metric.tone ?? 'neutral'}>{metric.value}</strong>
          </Card>
        ))}
      </div>

      <Card className="workspace-resource-table">
        <div className="workspace-resource-table__header">
          <span>Name</span>
          <span>Status</span>
          <span>Action</span>
        </div>
        {rows.length > 0 ? (
          rows.map((row) => <WorkspaceTableRow key={`${row.primary}-${row.secondary}`} row={row} />)
        ) : (
          <EmptyState {...emptyStateForTitle(title, actionHref, actionLabel)} />
        )}
      </Card>
    </section>
  );
}

function emptyStateForTitle(title: string, actionHref?: string, actionLabel?: string) {
  if (title === 'Layouts') {
    return {
      actionHref: '/charts',
      actionLabel: 'Open Charts',
      description: 'Save workspace layouts after arranging panels.',
      secondaryActionHref: '/preferences/appearance',
      secondaryActionLabel: 'Appearance',
      title: 'No saved layouts',
    };
  }

  return {
    actionHref,
    actionLabel,
    description: 'Create the first item to fill this workspace.',
    title: `No ${title.toLowerCase()}`,
  };
}

function WorkspaceTableRow({ row }: { row: WorkspaceRow }) {
  const content = (
    <>
      <div>
        <strong>{row.primary}</strong>
        <span>{row.secondary}</span>
      </div>
      <span className={cn(row.tone ?? 'neutral')}>{row.status}</span>
      <ArrowUpRight size={16} />
    </>
  );

  if (row.href) {
    return (
      <Link className="workspace-resource-table__row" href={row.href}>
        {content}
      </Link>
    );
  }

  return <div className="workspace-resource-table__row">{content}</div>;
}
