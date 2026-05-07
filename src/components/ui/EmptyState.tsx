import type { ReactNode } from 'react';
import { CircleDashed } from 'lucide-react';
import Link from 'next/link';

import { Button } from './Button';

type EmptyStateProps = {
  actionHref?: string;
  actionLabel?: string;
  description?: string;
  icon?: ReactNode;
  secondaryActionHref?: string;
  secondaryActionLabel?: string;
  title: string;
};

export function EmptyState({
  actionHref,
  actionLabel,
  description,
  icon = <CircleDashed size={20} />,
  secondaryActionHref,
  secondaryActionLabel,
  title,
}: EmptyStateProps) {
  return (
    <section className="ui-state">
      <span className="ui-state__icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actionLabel || secondaryActionLabel ? (
        <div className="ui-state__actions">
          {actionLabel ? <StateAction href={actionHref} label={actionLabel} variant="primary" /> : null}
          {secondaryActionLabel ? <StateAction href={secondaryActionHref} label={secondaryActionLabel} variant="ghost" /> : null}
        </div>
      ) : null}
    </section>
  );
}

function StateAction({ href, label, variant }: { href?: string; label: string; variant: 'primary' | 'ghost' }) {
  if (href) {
    return <Link className={`ui-button ui-button--${variant} ui-button--sm`} href={href}>{label}</Link>;
  }

  return (
    <Button size="sm" variant={variant}>
      {label}
    </Button>
  );
}
