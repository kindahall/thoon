import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/classNames';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  isActive?: boolean;
  isLoading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button({
  children,
  className,
  disabled,
  icon,
  isActive = false,
  isLoading = false,
  size = 'md',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn('ui-button', `ui-button--${variant}`, `ui-button--${size}`, isActive && 'is-active', className)}
      disabled={disabled || isLoading}
      type="button"
      {...props}
    >
      {icon ? <span className="ui-button__icon">{icon}</span> : null}
      <span>{isLoading ? 'Loading' : children}</span>
    </button>
  );
}

