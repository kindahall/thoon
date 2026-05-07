import type { ReactNode } from 'react';

type TooltipProps = {
  children: ReactNode;
  content: string;
};

export function Tooltip({ children, content }: TooltipProps) {
  return (
    <span className="ui-tooltip">
      {children}
      <span className="ui-tooltip__content" role="tooltip">
        {content}
      </span>
    </span>
  );
}

