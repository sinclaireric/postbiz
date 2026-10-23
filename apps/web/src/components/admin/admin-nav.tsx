'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface AdminNavItem {
  href: string;
  label: string;
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
        </Link>
      ))}
    </nav>
  );
}
