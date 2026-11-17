'use client';

import { useEffect, type ReactNode } from 'react';

interface Props {
  id: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}

/** Overlay modal using the existing .modal-overlay styles. Closes on backdrop click or Escape. */
export function Modal({ id, title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay active"
      id={id}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="close-modal" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <p className="modal-subtitle">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
