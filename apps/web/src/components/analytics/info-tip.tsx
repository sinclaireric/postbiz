'use client';

import { useId, useState } from 'react';
import { useDismiss } from '@/components/calendar/use-dismiss';

/**
 * Le « i » d'une carte : un clic (ou un toucher) déplie la définition de la métrique juste sous la carte, Échap ou un clic ailleurs la ferme.
 * La bulle se cale sur la carte (le parent positionné), pas sur le bouton, pour ne jamais sortir de l'écran sur téléphone.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const id = useId();
  return (
    <div ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="relative z-10 grid size-8 place-items-center rounded-full text-subtle transition-colors hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink aria-expanded:bg-black/5 aria-expanded:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.25M10 6.75h.01" />
        </svg>
      </button>
      {open && (
        <p id={id} className="absolute inset-x-2 top-full z-30 mt-1 rounded-xl bg-ink px-3 py-2.5 text-xs leading-relaxed text-white shadow-lg">
          {text}
        </p>
      )}
    </div>
  );
}
