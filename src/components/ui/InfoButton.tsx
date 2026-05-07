import { TooltipInfo } from './TooltipInfo';

type InfoButtonProps = {
  content: string;
  label: string;
};

export function InfoButton({ content, label }: InfoButtonProps) {
  return <TooltipInfo content={content} label={label} />;
}
