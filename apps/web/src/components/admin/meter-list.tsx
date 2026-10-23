import Link from 'next/link';
import type { ReactNode } from 'react';

export interface Meter {
  key: string;
  label: ReactNode;
  value: number;
  /** Texte à droite quand la valeur brute ne suffit pas (« 12 sur 40 »). */
  display?: ReactNode;
  href?: string;
}

/** Lignes avec une jauge proportionnelle : `max` fixe l'échelle (par défaut, la plus grande valeur de la liste). */
export function MeterList({ items, max, label }: { items: Meter[]; max?: number; label: string }) {
  const scale = Math.max(1, max ?? Math.max(0, ...items.map((i) => i.value)));
  return (
    <ul aria-label={label} className="grid gap-3">
      {items.map((i) => {
        const row = (
          <>
            <span className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium">{i.label}</span>
              <span className="shrink-0 text-muted tabular-nums">{i.display ?? i.value}</span>
            </span>
            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-wash" aria-hidden="true">
              <span className="block h-full rounded-full bg-forest-2" style={{ width: `${Math.min(100, (i.value / scale) * 100)}%` }} />
            </span>
          </>
        );
        return (
          <li key={i.key}>
            {i.href ? <Link href={i.href} className="block rounded-lg hover:bg-wash/60">{row}</Link> : row}
          </li>
        );
      })}
    </ul>
  );
}
