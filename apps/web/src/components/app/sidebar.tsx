'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';

const ICONS = {
  inbox: <path d="M3 12.5 5.2 5.4A2 2 0 0 1 7.1 4h7.8a2 2 0 0 1 1.9 1.4L19 12.5M3 12.5V16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5M3 12.5h4.2a1 1 0 0 1 .9.6 2.2 2.2 0 0 0 4 0 1 1 0 0 1 .9-.6H19" />,
  calendar: <path d="M5 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 4.5h14M7 2.5v3m6-3v3" />,
  channels: <path d="M4 10a6 6 0 0 1 6-6m-3 6a3 3 0 0 1 3-3m3 3a3 3 0 0 1-3 3m6-3a6 6 0 0 1-6 6M10 10h.01" />,
  settings: <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6.2-1.2 1.3 1-1.5 2.6-1.6-.5a6 6 0 0 1-1.4.8l-.3 1.6h-3l-.3-1.6a6 6 0 0 1-1.4-.8l-1.6.5-1.5-2.6 1.3-1a6 6 0 0 1 0-1.6l-1.3-1L5 6.2l1.6.5a6 6 0 0 1 1.4-.8L8.3 4.3h3l.3 1.6a6 6 0 0 1 1.4.8l1.6-.5 1.5 2.6-1.3 1c.1.5.1 1 0 1.5Z" />,
} as const;

const NAV = [
  { href: '/app/inbox', label: 'Boîte de réception', icon: 'inbox' as const },
  { href: '/app/publications', label: 'Publications', icon: 'calendar' as const },
  { href: '/app/canaux', label: 'Canaux', icon: 'channels' as const },
  { href: '/app/reglages', label: 'Réglages', icon: 'settings' as const },
];

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Sidebar({ orgName, role, userName, userEmail, unread, signOutAction }: {
  orgName: string; role: string; userName: string; userEmail: string; unread: number; signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Bureau */}
      <aside className="sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-5 pt-5"><Logo href="/app/inbox" /></div>
        <div className="mx-4 mt-5 rounded-xl border border-line bg-paper px-3 py-2.5">
          <p className="truncate text-sm font-semibold">{orgName}</p>
          <p className="text-xs text-subtle">{role}</p>
        </div>
        <nav className="mt-4 grid gap-1 px-3" aria-label="Application">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? 'page' : undefined}
              className={`flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${isActive(n.href) ? 'bg-ink text-white' : 'text-ink/75 hover:bg-wash hover:text-ink'}`}
            >
              <Icon name={n.icon} />
              <span className="flex-1">{n.label}</span>
              {n.icon === 'inbox' && unread > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${isActive(n.href) ? 'bg-lime text-ink' : 'bg-ink text-white'}`}>{unread}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-line p-4">
          <p className="truncate text-sm font-semibold">{userName}</p>
          <p className="truncate text-xs text-subtle">{userEmail}</p>
          <form action={signOutAction} className="mt-3">
            <button type="submit" className="text-sm font-medium text-muted underline underline-offset-4 hover:text-ink">Se déconnecter</button>
          </form>
        </div>
      </aside>

      {/* Mobile */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo href="/app/inbox" />
          <form action={signOutAction}><button type="submit" className="text-sm font-medium text-muted">Déconnexion</button></form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Application">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? 'page' : undefined}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold ${isActive(n.href) ? 'bg-ink text-white' : 'bg-wash text-ink/80'}`}
            >
              {n.label}
              {n.icon === 'inbox' && unread > 0 && <span className="rounded-full bg-lime px-1.5 text-xs font-bold text-ink">{unread}</span>}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
