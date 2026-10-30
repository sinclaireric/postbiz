import type { Metadata } from 'next';
import Link from 'next/link';
import { MeterList, type Meter } from '@/components/admin/meter-list';
import { SignupsChart } from '@/components/admin/signups-chart';
import { StatTile } from '@/components/admin/stat-tile';
import { SocialIcon } from '@/components/social-icon';
import { getT } from '@/i18n/server';
import { formatNumber } from '@/i18n/format';
import { loadOverview } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/admin/guard';
import { listHref, percent, revenue } from '@/lib/admin/logic';
import { PHASES, type Phase } from '@/lib/admin/types';
import { networkName } from '@/lib/networks';
import { PLAN_IDS, planNameKey } from '@/lib/billing/plans';
import { formatMoney } from '@/lib/billing/price';
import { LOCALE_META } from '@/i18n/config';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('admin.nav.overview') };
}
export const dynamic = 'force-dynamic';

const POST_STATES = ['published', 'queued', 'draft', 'error', 'unknown', 'publishing'] as const;
const card = 'rounded-3xl border border-line bg-surface p-6';
const h2 = 'text-lg font-semibold';

export default async function AdminOverviewPage() {
  await requireAdmin();
  const t = await getT();
  const o = await loadOverview();
  const n = (v: number) => formatNumber(t.locale, v);
  const money = revenue(o.byPlan);
  const trialsActive = o.phases.trialing;

  const phaseMeters: Meter[] = PHASES.map((p: Phase) => ({
    key: p, label: t(`admin.phase.${p}`), value: o.phases[p], display: n(o.phases[p]), href: listHref('/admin/abonnements', { phase: p }),
  }));
  const usd = (v: number) => formatMoney(LOCALE_META[t.locale].tag, v, 'USD');
  const planRows = PLAN_IDS.map((id) => ({ id })).map((p) => {
    const rows = o.byPlan.filter((r) => r.plan === p.id && r.provider !== 'gift');
    const paying = rows.filter((r) => r.phase === 'paying').reduce((s, r) => s + r.count, 0);
    const trials = rows.filter((r) => r.phase === 'trialing').reduce((s, r) => s + r.count, 0);
    return { id: p.id, paying, trials };
  }).filter((r) => r.paying + r.trials > 0);
  const networkMeters: Meter[] = Object.entries(o.channels.byProvider)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({
      key: id, value: count, display: n(count),
      label: <><SocialIcon id={id as never} size={18} /><span className="truncate">{networkName(id)}</span></>,
    }));
  const stateMeters: Meter[] = POST_STATES.filter((s) => (o.posts.byState[s] ?? 0) > 0).map((s) => ({
    key: s, label: t(`admin.postState.${s}`), value: o.posts.byState[s] ?? 0, display: n(o.posts.byState[s] ?? 0),
  }));

  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight">{t('admin.overview.title')}</h1>
      <p className="mt-1 text-muted">{t('admin.overview.subtitle')}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label={t('admin.kpi.users')} value={n(o.users.total)} hint={t('admin.kpi.usersHint', { count: n(o.users.new7d) })} />
        <StatTile label={t('admin.kpi.active')} value={n(o.users.active7d)} hint={t('admin.kpi.activeHint', { percent: percent(o.users.active7d, o.users.total) })} />
        <StatTile label={t('admin.kpi.trials')} value={n(trialsActive)} hint={t('admin.kpi.trialsHint', { count: n(o.trialsEnding3d) })} tone={o.trialsEnding3d > 0 ? 'warn' : 'neutral'} />
        <StatTile label={t('admin.kpi.paying')} value={n(money.payingOrgs)} hint={t('admin.kpi.payingHint', { count: n(o.cancelAtPeriodEnd) })} />
        <StatTile label={t('admin.kpi.mrr')} value={usd(money.mrr)} hint={t('admin.kpi.mrrHint', { amount: usd(money.arr) })} />
        <StatTile label={t('admin.kpi.expired')} value={n(o.phases.trial_expired)} hint={t('admin.kpi.expiredHint')} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className={card} aria-labelledby="signups">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="signups" className={h2}>{t('admin.signups.title')}</h2>
            <span className="text-sm text-muted">{t('admin.signups.total', { count: n(o.users.new30d) })}</span>
          </div>
          <div className="mt-5"><SignupsChart days={o.signups} t={t} /></div>
        </section>

        <section className={card} aria-labelledby="subs">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="subs" className={h2}>{t('admin.subs.title')}</h2>
            <Link href="/admin/abonnements" className="text-sm font-semibold underline underline-offset-4">{t('admin.subs.open')}</Link>
          </div>
          <div className="mt-5"><MeterList items={phaseMeters} max={o.orgs.total} label={t('admin.subs.title')} /></div>
          {planRows.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <p className="text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('admin.subs.byPlan')}</p>
              <ul className="mt-2 grid gap-1.5 text-sm">
                {planRows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="font-medium">{t(planNameKey(r.id))}</span>
                    <span className="text-muted tabular-nums">{t('admin.kpi.paying')} {n(r.paying)} · {t('admin.kpi.trials')} {n(r.trials)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {money.trialPotential > 0 && <p className="mt-4 text-sm text-muted">{t('admin.subs.trialPotential', { amount: usd(money.trialPotential) })}</p>}
          {o.phases.none > 0 && <p className="mt-3 rounded-2xl bg-wash px-4 py-3 text-xs leading-relaxed text-muted">{t('admin.subs.noneNote')}</p>}
        </section>

        <section className={`${card} lg:col-span-2`} aria-labelledby="usage">
          <h2 id="usage" className={h2}>{t('admin.usage.title')}</h2>
          <div className="mt-5 grid gap-8 md:grid-cols-3">
            <div className="grid content-start gap-5">
              <MeterList
                label={t('admin.usage.title')} max={o.orgs.total}
                items={[
                  { key: 'channel', label: t('admin.usage.withChannel'), value: o.orgs.withChannel, display: t('admin.usage.of', { part: n(o.orgs.withChannel), whole: n(o.orgs.total) }) },
                  { key: 'published', label: t('admin.usage.withPublished'), value: o.orgs.withPublished, display: t('admin.usage.of', { part: n(o.orgs.withPublished), whole: n(o.orgs.total) }) },
                ]}
              />
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted">{t('admin.usage.channels')}</dt><dd className="font-semibold tabular-nums">{n(o.channels.total)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">{t('admin.usage.needsReconnect')}</dt><dd className={`font-semibold tabular-nums ${o.channels.needsReconnect > 0 ? 'text-warn' : ''}`}>{n(o.channels.needsReconnect)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">{t('admin.usage.posts')}</dt><dd className="font-semibold tabular-nums">{n(o.posts.created7d)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">{t('admin.usage.unconfirmed')}</dt><dd className="font-semibold tabular-nums">{n(o.users.unconfirmed)}</dd></div>
              </dl>
            </div>
            <div>
              <p className="mb-3 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('admin.usage.byNetwork')}</p>
              <MeterList items={networkMeters} label={t('admin.usage.byNetwork')} />
            </div>
            <div>
              <p className="mb-3 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('admin.usage.postsByState')}</p>
              <MeterList items={stateMeters} label={t('admin.usage.postsByState')} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
