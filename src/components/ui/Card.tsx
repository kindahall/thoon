import type { HTMLAttributes } from 'react';

import { cn } from '../../utils/classNames';

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'section';
};

export function Card({ as: Component = 'section', className, ...props }: CardProps) {
  return <Component className={cn('ui-card', className)} {...props} />;
}

