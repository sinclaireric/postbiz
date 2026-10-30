import type { Metadata } from 'next';
import Link from 'next/link';
import { signOut } from '@/app/(auth)/actions';
import { AdminNav } from '@/components/admin/admin-nav';
import { Logo } from '@/components/logo';
import { Badge } from '@/components/ui';
import { getT } from '@/i18n/server';
import { requireAdmin } from '@/lib/admin/guard';
import { loadSupportSummary } from '@/lib/admin/support-data';
import { isDemo } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: { default: 'Administration', template: '%s · Administration' },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  const { email } = await requireAdmin();
  // Messages de support non lus (pastille de l'onglet). Si la migration du chat n'est pas appliquée, l'espace s'ouvre quand même, sans pastille.
  const support = await loadSupportSummary().catch(() => null);
  const items = [
    { href: '/admin', label: t('admin.nav.overview') },
    { href: '/admin/utilisateurs', label: t('admin.nav.users') },
    { href: '/admin/abonnements', label: t('admin.nav.subscriptions') },
    { href: '/admin/support', label: t('admin.nav.support'), badge: support?.unread ?? 0, badgeLabel: t('admin.support.unreadLabel') },
  ];
  return (
    <div className="min-h-dvh bg-paper">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        {t('common.skipToContent')}
      </a>
      {isDemo && <p className="border-b border-warn/25 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">{t('admin.demoNotice')}</p>}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
            <span className="flex items-center gap-3">
              <Logo href="/admin" />
              <Badge tone="lime">{t('admin.badge')}</Badge>
            </span>
            <span className="flex items-center gap-3 text-sm">
              <span className="hidden max-w-60 truncate text-subtle sm:inline" dir="ltr">{email}</span>
              <Link href="/app" className="font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">{t('admin.backToApp')}</Link>
              <form action={signOut}>
                <button type="submit" className="rounded-full border border-line px-3.5 py-1.5 font-semibold hover:bg-wash">{t('admin.signOut')}</button>
              </form>
            </span>
          </div>
          <AdminNav items={items} label={t('admin.nav.label')} />
        </div>
      </header>
      <main id="contenu" className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-8">{children}</main>
    </div>
  );
}
