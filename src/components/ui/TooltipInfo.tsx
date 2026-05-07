import { Info } from 'lucide-react';

import { Tooltip } from './Tooltip';

type TooltipInfoProps = {
  content: string;
  label?: string;
};

export function TooltipInfo({ content, label = 'Info' }: TooltipInfoProps) {
  return (
    <Tooltip content={content}>
      <button aria-label={label} className="ui-info-button" type="button">
        <Info size={13} />
      </button>
    </Tooltip>
  );
}

