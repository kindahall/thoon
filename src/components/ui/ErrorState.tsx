import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Button } from './Button';

type ErrorStateProps = {
  actionHref?: string;
  actionLabel?: string;
  cancelLabel?: string;
  description?: string;
  details?: Array<{
    label: string;
    tone?: 'neutral' | 'positive' | 'negative' | 'warning';
    value: string;
  }>;
  icon?: ReactNode;
  onCancel?: () => void;
  secondaryActionHref?: string;
  secondaryActionLabel?: string;
  title: string;
};

export function ErrorState({
  actionHref,
  actionLabel,
  cancelLabel,
  description,
  details,
  icon = <AlertTriangle size={20} />,
  onCancel,
  secondaryActionHref,
  secondaryActionLabel,
  title,
}: ErrorStateProps) {
  return (
    <section className="ui-state ui-state--error">
      <span className="ui-state__icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {details?.length ? (
        <dl className="ui-state__details">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd className={detail.tone}>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actionLabel || secondaryActionLabel || cancelLabel ? (
        <div className="ui-state__actions">
          {actionLabel ? <ErrorAction href={actionHref} label={actionLabel} variant="danger" /> : null}
          {secondaryActionLabel ? <ErrorAction href={secondaryActionHref} label={secondaryActionLabel} variant="ghost" /> : null}
          {cancelLabel ? (
            <Button onClick={onCancel} size="sm" variant="ghost">
              {cancelLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ErrorAction({ href, label, variant }: { href?: string; label: string; variant: 'danger' | 'ghost' }) {
  if (href) {
    return <Link className={`ui-button ui-button--${variant} ui-button--sm`} href={href}>{label}</Link>;
  }

  return (
    <Button size="sm" variant={variant}>
      {label}
    </Button>
  );
}
