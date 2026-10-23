import type { Metadata } from 'next';
import Link from 'next/link';
import { ListFilters } from '@/components/admin/list-filters';
import { PhaseCell, PlanCell } from '@/components/admin/phase-cell';
import { Pager } from '@/components/admin/pager';
import { formatFullDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { loadOrganizations, loadOverview } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/admin/guard';
import { listHref, pageCount, parseListQuery } from '@/lib/admin/logic';
import { PHASES } from '@/lib/admin/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('admin.nav.subscriptions') };
}
export const dynamic = 'force-dynamic';

const th = 'border-b border-line px-4 py-3 text-start text-xs font-semibold tracking-wide text-muted uppercase whitespace-nowrap';
const td = 'px-4 py-3 align-top';

export default async function AdminSubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const t = await getT();
  const query = parseListQuery(await searchParams);
  const [{ rows, total }, overview] = await Promise.all([loadOrganizations(query), loadOverview()]);
  const pages = pageCount(total);
  const now = new Date();
  const base = '/admin/abonnements';
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:bg-wash'}`;

  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight">{t('admin.orgs.title')}</h1>
      <p className="mt-1 text-muted">{t('admin.orgs.subtitle')}</p>

      <nav aria-label={t('admin.filter.phase')} className="mt-6 flex flex-wrap gap-2">
        <Link href={listHref(base, { search: query.search })} className={chip(!query.phase)} aria-current={!query.phase ? 'true' : undefined}>{t('admin.filter.allPhases')}</Link>
        {PHASES.map((p) => (
          <Link key={p} href={listHref(base, { search: query.search, phase: p })} className={chip(query.phase === p)} aria-current={query.phase === p ? 'true' : undefined}>
            {t(`admin.phase.${p}`)}
            <span className={`tabular-nums ${query.phase === p ? 'text-white/70' : 'text-muted'}`}>{formatNumber(t.locale, overview.phases[p])}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-5"><ListFilters action={base} query={query} placeholder={t('admin.orgs.searchPlaceholder')} t={t} phaseSelect={false} /></div>
      <p className="mt-5 text-sm text-muted" aria-live="polite">{t('admin.list.results', { count: formatNumber(t.locale, total) })}</p>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-3xl border border-line bg-surface px-6 py-12 text-center">
          <p className="text-muted">{t('admin.list.empty')}</p>
          <Link href={base} className="mt-3 inline-block text-sm font-semibold underline underline-offset-4">{t('admin.list.showAll')}</Link>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-3xl border border-line bg-surface">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr>
                <th scope="col" className={th}>{t('admin.col.org')}</th>
                <th scope="col" className={th}>{t('admin.col.owner')}</th>
                <th scope="col" className={th}>{t('admin.col.plan')}</th>
                <th scope="col" className={th}>{t('admin.col.status')}</th>
                <th scope="col" className={`${th} text-end`}>{t('admin.col.members')}</th>
                <th scope="col" className={`${th} text-end`}>{t('admin.col.channels')}</th>
                <th scope="col" className={`${th} text-end`}>{t('admin.col.posts')}</th>
                <th scope="col" className={th}>{t('admin.col.created')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.orgId} className="border-b border-line last:border-0">
                  <td className={`${td} font-medium`}>{o.name}</td>
                  <td className={td} dir="ltr">{o.ownerEmail ?? <span className="text-subtle">—</span>}</td>
                  <td className={td}><PlanCell sub={o} t={t} /></td>
                  <td className={td}><PhaseCell sub={o} t={t} now={now} /></td>
                  <td className={`${td} text-end tabular-nums`}>{formatNumber(t.locale, o.membersCount)}</td>
                  <td className={`${td} text-end tabular-nums`}>{formatNumber(t.locale, o.channelsCount)}</td>
                  <td className={`${td} text-end tabular-nums`}>{formatNumber(t.locale, o.postsCount)}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatFullDate(t.locale, new Date(o.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={query.page} pages={pages} href={(page) => listHref(base, { ...query, page })} t={t} />
    </>
  );
}
