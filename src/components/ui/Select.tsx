import type { ReactNode, SelectHTMLAttributes } from 'react';

import { cn } from '../../utils/classNames';

type SelectOption = {
  label: string;
  value: string;
};

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options: SelectOption[];
  prefix?: ReactNode;
};

export function Select({ className, options, prefix, ...props }: SelectProps) {
  return (
    <label className={cn('ui-field', className)}>
      {prefix ? <span className="ui-field__affix">{prefix}</span> : null}
      <select className="ui-select" {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

