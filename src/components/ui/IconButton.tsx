import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/classNames';

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
};

export function IconButton({ className, icon, label, ...props }: IconButtonProps) {
  const ariaLabel = props['aria-label'] ?? label;

  return (
    <button {...props} aria-label={ariaLabel} className={cn('ui-icon-button', className)} title={label} type="button">
      <span className="sr-only">{label}</span>
      {icon}
    </button>
  );
}
