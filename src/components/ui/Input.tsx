import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/classNames';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function Input({ className, prefix, suffix, ...props }: InputProps) {
  return (
    <label className={cn('ui-field', className)}>
      {prefix ? <span className="ui-field__affix">{prefix}</span> : null}
      <input className="ui-input" {...props} />
      {suffix ? <span className="ui-field__affix">{suffix}</span> : null}
    </label>
  );
}

