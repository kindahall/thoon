import type { HTMLAttributes } from 'react';

import { cn } from '../../utils/classNames';

type BadgeTone = 'neutral' | 'primary' | 'positive' | 'negative' | 'warning';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return <span className={cn('ui-badge', `ui-badge--${tone}`, className)} {...props} />;
}

