import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/admin/auto-refresh';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui';
import { formatNumber, formatRelative } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { requireAdmin } from '@/lib/admin/guard';
import { pageCount } from '@/lib/admin/logic';
import { loadSupportList, loadSupportSummary } from '@/lib/admin/support-data';
import { SUPPORT_PAGE_SIZE, parseSupportQuery, supportHref } from '@/lib/support/logic';
import { SUPPORT_FILTERS } from '@/lib/support/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('admin.nav.support') };
}
export const dynamic = 'force-dynamic';

const th = 'border-b border-line px-4 py-3 text-start text-xs font-semibold tracking-wide text-muted uppercase whitespace-nowrap';
const td = 'px-4 py-3 align-top';
const field = 'h-11 rounded-full border border-line bg-surface px-4 text-[15px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40';

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const t = await getT();
  const query = parseSupportQuery(await searchParams);
  const base = '/admin/support';

  let data: Awaited<ReturnType<typeof loadSupportList>>;
  let summary: Awaited<ReturnType<typeof loadSupportSummary>>;
  try {
    [data, summary] = await Promise.all([loadSupportList(query), loadSupportSummary()]);
  } catch (error) {
    // Migration pas encore appliquée (fonctions absentes) : on le dit au lieu d'afficher une page d'erreur.
    console.error('[admin/support]', error);
    return (
      <>
        <h1 className="text-[28px] font-semibold tracking-tight">{t('admin.support.title')}</h1>
        <p role="alert" className="mt-4 rounded-3xl border border-warn/25 bg-warn-soft px-5 py-4 text-sm leading-relaxed text-warn">{t('admin.support.setup')}</p>
      </>
    );
  }

  const { rows, total } = data;
  const now = new Date();
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:bg-wash'}`;
  const counts = { all: summary.all, unread: summary.unread, open: summary.open, resolved: summary.resolved };

  return (
    <>
      <AutoRefresh />
      <h1 className="text-[28px] font-semibold tracking-tight">{t('admin.support.title')}</h1>
      <p className="mt-1 text-muted">{t('admin.support.subtitle')}</p>

      <nav aria-label={t('admin.support.filter.label')} className="mt-6 flex flex-wrap gap-2">
        {SUPPORT_FILTERS.map((f) => (
          <Link key={f} href={supportHref(base, { filter: f, search: query.search })} className={chip(query.filter === f)} aria-current={query.filter === f ? 'true' : undefined}>
            {t(`admin.support.filter.${f}`)}
            <span className={`tabular-nums ${query.filter === f ? 'text-white/70' : 'text-muted'}`}>{formatNumber(t.locale, counts[f])}</span>
          </Link>
        ))}
      </nav>

      <form action={base} method="get" role="search" className="mt-5 flex flex-wrap items-end gap-3">
        {query.filter !== 'all' && <input type="hidden" name="filtre" value={query.filter} />}
        <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-muted sm:min-w-64">
          {t('admin.filter.search')}
          <input type="search" name="q" defaultValue={query.search} placeholder={t('admin.support.searchPlaceholder')} maxLength={100} className={field} />
        </label>
        <button type="submit" className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-[15px] font-semibold text-white hover:bg-black/80">{t('admin.filter.submit')}</button>
        {query.search && <Link href={supportHref(base, { filter: query.filter })} className="inline-flex h-11 items-center px-2 text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink">{t('admin.filter.reset')}</Link>}
      </form>
      <p className="mt-5 text-sm text-muted" aria-live="polite">{t('admin.list.results', { count: formatNumber(t.locale, total) })}</p>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-3xl border border-line bg-surface px-6 py-12 text-center">
          <p className="text-muted">{query.search || query.filter !== 'all' ? t('admin.list.empty') : t('admin.support.empty')}</p>
          {(query.search || query.filter !== 'all') && <Link href={base} className="mt-3 inline-block text-sm font-semibold underline underline-offset-4">{t('admin.list.showAll')}</Link>}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-3xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr>
                <th scope="col" className={th}>{t('admin.support.col.user')}</th>
                <th scope="col" className={th}>{t('admin.support.col.lastMessage')}</th>
                <th scope="col" className={th}>{t('admin.support.col.status')}</th>
                <th scope="col" className={th}>{t('admin.support.col.activity')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const awaiting = c.status === 'open' && c.lastAuthor === 'user';
                return (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className={`${td} min-w-52`}>
                      <Link href={`${base}/${c.id}`} className="block font-semibold hover:underline">{c.name || c.email}</Link>
                      {c.name && <span className="block truncate text-muted" dir="ltr">{c.email}</span>}
                      {c.orgName && <span className="block truncate text-subtle">{c.orgName}</span>}
                    </td>
                    <td className={`${td} max-w-md`}>
                      <Link href={`${base}/${c.id}`} className={`line-clamp-2 break-words ${c.supportUnread > 0 ? 'font-semibold text-ink' : 'text-muted'}`} dir="auto">
                        {c.lastAuthor === 'support' && <span className="text-subtle">{t('admin.support.youPrefix')} </span>}
                        {c.lastBody}
                      </Link>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={c.status === 'resolved' ? 'ok' : 'neutral'}>{t(`admin.support.status.${c.status}`)}</Badge>
                        {awaiting && <Badge tone="warn">{t('admin.support.awaiting')}</Badge>}
                        {c.supportUnread > 0 && <Badge tone="lime">{t('admin.support.unreadBadge', { count: formatNumber(t.locale, c.supportUnread) })}</Badge>}
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap text-muted`}>{formatRelative(t.locale, c.lastMessageAt, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={query.page} pages={pageCount(total, SUPPORT_PAGE_SIZE)} href={(page) => supportHref(base, { ...query, page })} t={t} />
    </>
  );
}
