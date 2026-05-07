'use client';

import type { ButtonHTMLAttributes } from 'react';

import { cn } from '../../utils/classNames';

type ToggleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  checked: boolean;
  label: string;
};

export function Toggle({ checked, className, label, ...props }: ToggleProps) {
  return (
    <button aria-checked={checked} className={cn('ui-toggle', checked && 'is-checked', className)} role="switch" type="button" {...props}>
      <span className="ui-toggle__track">
        <span className="ui-toggle__thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

