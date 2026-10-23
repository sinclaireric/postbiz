import type { Metadata } from 'next';
import Link from 'next/link';
import { ListFilters } from '@/components/admin/list-filters';
import { PhaseCell, PlanCell } from '@/components/admin/phase-cell';
import { Pager } from '@/components/admin/pager';
import { formatFullDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { loadUsers } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/admin/guard';
import { listHref, pageCount, parseListQuery } from '@/lib/admin/logic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('admin.nav.users') };
}
export const dynamic = 'force-dynamic';

const th = 'border-b border-line px-4 py-3 text-start text-xs font-semibold tracking-wide text-muted uppercase whitespace-nowrap';
const td = 'px-4 py-3 align-top';

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const t = await getT();
  const query = parseListQuery(await searchParams);
  const { rows, total } = await loadUsers(query);
  const pages = pageCount(total);
  const now = new Date();
  const base = '/admin/utilisateurs';

  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight">{t('admin.users.title')}</h1>
      <p className="mt-1 text-muted">{t('admin.users.subtitle')}</p>
      <div className="mt-6"><ListFilters action={base} query={query} placeholder={t('admin.users.searchPlaceholder')} t={t} /></div>
      <p className="mt-5 text-sm text-muted" aria-live="polite">{t('admin.list.results', { count: formatNumber(t.locale, total) })}</p>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-3xl border border-line bg-surface px-6 py-12 text-center">
          <p className="text-muted">{t('admin.list.empty')}</p>
          <Link href={base} className="mt-3 inline-block text-sm font-semibold underline underline-offset-4">{t('admin.list.showAll')}</Link>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-3xl border border-line bg-surface">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr>
                <th scope="col" className={th}>{t('admin.col.user')}</th>
                <th scope="col" className={th}>{t('admin.col.org')}</th>
                <th scope="col" className={th}>{t('admin.col.plan')}</th>
                <th scope="col" className={th}>{t('admin.col.status')}</th>
                <th scope="col" className={`${th} text-end`}>{t('admin.col.channels')}</th>
                <th scope="col" className={`${th} text-end`}>{t('admin.col.posts')}</th>
                <th scope="col" className={th}>{t('admin.col.signedUp')}</th>
                <th scope="col" className={th}>{t('admin.col.lastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.userId} className="border-b border-line last:border-0">
                  <td className={td}>
                    <p className="font-medium">{u.name ?? u.email}</p>
                    {u.name && u.name !== u.email && <p className="text-xs text-muted" dir="ltr">{u.email}</p>}
                    {!u.emailConfirmed && <p className="mt-1 text-xs font-medium text-warn">{t('admin.cell.unconfirmed')}</p>}
                  </td>
                  <td className={td}>
                    {u.orgName ? (
                      <>
                        <p className="font-medium">{u.orgName}</p>
                        {u.orgsCount > 1 && <p className="text-xs text-muted">{t('admin.cell.orgsCount', { count: u.orgsCount })}</p>}
                      </>
                    ) : <span className="text-subtle">{t('admin.cell.noOrg')}</span>}
                  </td>
                  <td className={td}><PlanCell sub={u} t={t} /></td>
                  <td className={td}><PhaseCell sub={u} t={t} now={now} /></td>
                  <td className={`${td} text-end tabular-nums`}>{formatNumber(t.locale, u.channelsCount)}</td>
                  <td className={`${td} text-end tabular-nums`}>{formatNumber(t.locale, u.postsCount)}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatFullDate(t.locale, new Date(u.createdAt))}</td>
                  <td className={`${td} whitespace-nowrap`}>{u.lastSignInAt ? formatFullDate(t.locale, new Date(u.lastSignInAt)) : <span className="text-subtle">{t('admin.cell.never')}</span>}</td>
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
