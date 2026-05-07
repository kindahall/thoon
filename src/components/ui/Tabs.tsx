'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '../../utils/classNames';

export type TabItem = {
  content: ReactNode;
  id: string;
  label: string;
};

type TabsProps = {
  defaultValue?: string;
  items: TabItem[];
};

export function Tabs({ defaultValue, items }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultValue ?? items[0]?.id);
  const activeItem = items.find((item) => item.id === activeId);

  return (
    <div className="ui-tabs">
      <div aria-label="Tabs" className="ui-tabs__list" role="tablist">
        {items.map((item) => (
          <button
            aria-selected={item.id === activeId}
            className={cn('ui-tabs__tab', item.id === activeId && 'is-active')}
            key={item.id}
            onClick={() => setActiveId(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="ui-tabs__panel" role="tabpanel">
        {activeItem?.content}
      </div>
    </div>
  );
}

