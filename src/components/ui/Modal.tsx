'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

import { IconButton } from './IconButton';

type ModalProps = {
  children: ReactNode;
  onClose?: () => void;
  open: boolean;
  title: string;
};

export function Modal({ children, onClose, open, title }: ModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="ui-modal" role="presentation">
      <section aria-modal="true" className="ui-modal__panel" role="dialog">
        <header className="ui-modal__header">
          <h2>{title}</h2>
          {onClose ? <IconButton icon={<X size={16} />} label="Close" onClick={onClose} /> : null}
        </header>
        {children}
      </section>
    </div>
  );
}

