'use client';

import { useState } from 'react';
import { CircleHelp } from 'lucide-react';

import { cn } from '../../utils/classNames';

type HelpPopoverProps = {
  items: string[];
  title: string;
};

export function HelpPopover({ items, title }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ui-help">
      <button aria-expanded={open} aria-label={`${title} help`} className={cn('ui-icon-button', open && 'is-active')} onClick={() => setOpen((current) => !current)} type="button">
        <CircleHelp size={17} />
      </button>
      {open ? (
        <section className="ui-help__panel">
          <h2>{title}</h2>
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

