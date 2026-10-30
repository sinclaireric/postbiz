'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface AdminNavItem {
  href: string;
  label: string;
  /** Pastille (nombre à traiter), masquée à zéro. */
  badge?: number;
  /** Texte lu par les lecteurs d'écran pour la pastille. */
  badgeLabel?: string;
}

/** Onglets de l'espace propriétaire. Les textes viennent du serveur : les messages `admin.*` ne sont pas envoyés au navigateur. */
export function AdminNav({ items, label }: { items: AdminNavItem[]; label: string }) {
  const pathname = usePathname();
  const active = (href: string) => (href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto">
      {items.map((item) => (
        <Link
          key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined}
          className={`border-b-2 px-3 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${active(item.href) ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          {item.label}
          {item.badge ? (
            <span className="ms-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-lime px-1.5 text-[11px] font-bold text-ink">
              {item.badge > 99 ? '99+' : item.badge}
              {item.badgeLabel && <span className="sr-only"> {item.badgeLabel}</span>}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
