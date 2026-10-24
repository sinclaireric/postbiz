'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Logo, LogoMark } from '@/components/logo';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';
import type { NotificationItem } from '@/lib/data/types';
import { NavIcon, type NavIconName } from './nav-icons';
import { NotificationsMenu } from './notifications-menu';
import { UserMenu } from './user-menu';

interface NavItem {
  href: string;
  label: MessageKey;
  icon: NavIconName;
  /** Fonctionnalité de Postiz pas encore disponible dans Postbiz. */
  soon?: boolean;
  badge?: 'inbox';
}

const MAIN: NavItem[] = [
  { href: '/app/calendrier', label: 'app.nav.calendar', icon: 'calendar' },
  { href: '/app/inbox', label: 'app.nav.inbox', icon: 'inbox', badge: 'inbox' },
  { href: '/app/agent', label: 'app.nav.agent', icon: 'agent' },
  { href: '/app/analyses', label: 'app.nav.analytics', icon: 'analytics' },
  { href: '/app/medias', label: 'app.nav.media', icon: 'media' },
  { href: '/app/canaux', label: 'app.nav.channels', icon: 'channels' },
];
const BOTTOM: NavItem[] = [
  { href: '/app/facturation', label: 'app.nav.billing', icon: 'billing', soon: true },
  { href: '/app/reglages', label: 'app.nav.settings', icon: 'settings' },
];
const MOBILE: NavItem[] = [...MAIN, BOTTOM[1]!];

const TITLES: Record<string, MessageKey> = {
  '/app/calendrier': 'app.titles.calendar',
  '/app/inbox': 'app.titles.inbox',
  '/app/agent': 'app.titles.agent',
  '/app/analyses': 'app.titles.analytics',
  '/app/medias': 'app.titles.media',
  '/app/canaux': 'app.titles.channels',
  '/app/reglages': 'app.titles.settings',
};

function RailItem({ item, active, unread }: { item: NavItem; active: boolean; unread: number }) {
  const t = useT();
  const body = (
    <>
      <span className="relative">
        <NavIcon name={item.icon} />
        {item.badge === 'inbox' && unread > 0 && (
          <span className="absolute -top-1.5 -end-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">{unread}</span>
        )}
      </span>
      <span className="text-[11px] leading-tight font-medium">{t(item.label)}</span>
    </>
  );
  const cls = 'flex w-[72px] flex-col items-center gap-1 rounded-2xl px-1 py-2.5 transition-colors';
  if (item.soon) {
    return <span aria-disabled="true" title={t('app.nav.soon')} className={`${cls} cursor-not-allowed text-ink/30`}>{body}</span>;
  }
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={`${cls} ${active ? 'bg-lime-soft text-forest' : 'text-ink/65 hover:bg-wash hover:text-ink'}`}>
      {body}
    </Link>
  );
}

export function AppShell({
  children, orgName, roleLabel, userName, userEmail, unreadMessages, notifications, signOutAction, markNotificationsRead, adminLink, demo,
}: {
  children: ReactNode; orgName: string; roleLabel: string; userName: string; userEmail: string; unreadMessages: number;
  notifications: NotificationItem[]; signOutAction: () => Promise<void>; markNotificationsRead: () => Promise<void>;
  /** Lien vers l'espace propriétaire, présent seulement pour le propriétaire de la plateforme. */
  adminLink?: { href: string; label: string }; demo: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const titleKey = Object.entries(TITLES).find(([href]) => isActive(href))?.[1];
  const title = titleKey ? t(titleKey) : 'Postbiz';

  return (
    <div className="flex min-h-dvh flex-col bg-wash lg:h-dvh lg:flex-row lg:gap-3 lg:p-3">
      {/* Rail d'icônes (bureau) */}
      <aside className="hidden w-[92px] shrink-0 flex-col items-center rounded-3xl border border-line bg-surface py-4 lg:flex">
        <Link href="/app/calendrier" aria-label={t('app.nav.home')} title={orgName}><LogoMark size={44} /></Link>
        <nav className="mt-6 flex flex-col items-center gap-1" aria-label={t('app.nav.label')}>
          {MAIN.map((n) => <RailItem key={n.href} item={n} active={isActive(n.href)} unread={unreadMessages} />)}
        </nav>
        <nav className="mt-auto flex flex-col items-center gap-1" aria-label={t('app.nav.accountLabel')}>
          {BOTTOM.map((n) => <RailItem key={n.href} item={n} active={isActive(n.href)} unread={0} />)}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-[68px] lg:overflow-hidden lg:rounded-3xl lg:border lg:border-line lg:bg-surface lg:pb-0">
        {demo && (
          <p className="border-b border-warn/25 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">
            {t('app.demoStrip')}
          </p>
        )}
        <header className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 lg:px-7">
          <div className="flex items-center gap-3">
            <span className="lg:hidden"><Logo href="/app/calendrier" className="!text-base" /></span>
            <h1 className="sr-only text-[22px] font-semibold tracking-tight lg:not-sr-only">{title}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher />
            <NotificationsMenu notifications={notifications} markRead={markNotificationsRead} />
            <UserMenu name={userName} email={userEmail} orgName={orgName} role={roleLabel} signOutAction={signOutAction} adminLink={adminLink} />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col bg-paper lg:overflow-y-auto">{children}</div>
      </div>

      {/* Barre d'onglets (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-surface px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden" aria-label={t('app.nav.label')}>
        {MOBILE.map((n) => (
          <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined} className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 ${isActive(n.href) ? 'text-forest' : 'text-ink/60'}`}>
            <span className="relative">
              <NavIcon name={n.icon} size={22} />
              {n.badge === 'inbox' && unreadMessages > 0 && <span className="absolute -top-1 -end-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">{unreadMessages}</span>}
            </span>
            <span className="truncate text-[10px] font-medium">{t(n.label)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
