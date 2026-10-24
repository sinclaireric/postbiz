import type { ReactNode } from 'react';

/** Une carte blanche posée sur un panneau : le fond des tuiles, des tableaux et des graphiques de la page. */
export const tile = 'rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(17,17,16,0.04)]';

/**
 * Un bloc de la page : un fond gris doux, un titre, une phrase d'explication, et des cartes blanches à l'intérieur. Tous les blocs de la
 * page Analyses ont cette même tête, ce qui donne le rythme : on sait toujours où commence un bloc et ce qu'il compte.
 */
export function Panel({ id, title, subtitle, action, children, className = '' }: { id: string; title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-[28px] bg-wash/70 p-4 sm:p-6 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 sm:mb-5">
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-sm leading-relaxed text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
