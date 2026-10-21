'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n/client';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Fenêtre modale accessible : focus piégé, Échap pour fermer, retour du focus à la fermeture,
 * défilement de la page bloqué. Rendue dans <body> : un ancêtre avec `backdrop-filter` (l'en-tête du site,
 * par exemple) devient sinon le repère de `position: fixed` et la fenêtre se retrouve centrée sur lui.
 * Toujours montée après une action de l'utilisateur, jamais au rendu serveur.
 */
export function Modal({
  title, onClose, children, width = 'max-w-xl', closeOnBackdrop = true, actions, header = true,
}: { title: string; onClose: () => void; children: ReactNode; width?: string; closeOnBackdrop?: boolean; actions?: ReactNode; header?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`max-h-[92dvh] w-full ${width} overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] outline-none`}>
        {header && (
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <button type="button" onClick={onClose} aria-label={t('app.modal.close')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-wash hover:text-ink">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>
        )}
        <div className={header ? 'mt-4' : ''}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
