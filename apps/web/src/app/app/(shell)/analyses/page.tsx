import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Delta } from '@/components/analytics/delta';
import { ChannelFilter, PeriodFilter } from '@/components/analytics/filters';
import { MetricCard } from '@/components/analytics/metric-card';
import { MetricChart } from '@/components/analytics/metric-chart';
import { Panel, tile } from '@/components/analytics/panel';
import { PerformanceTable } from '@/components/analytics/performance-table';
import { RecentPosts } from '@/components/analytics/recent-posts';
import { ButtonLink } from '@/components/ui';
import { getT } from '@/i18n/server';
import { formatAverage, formatCount, formatDay, formatDayYear, formatMetric, formatSigned } from '@/lib/analytics/format';
import { analyticsHref, buildView, dayKey, parseAnalyticsParams, periodWindows } from '@/lib/analytics/logic';
import { ACTIVITY_METRICS, AUDIENCE_METRICS, LOWER_IS_BETTER, METRIC_KIND, type CardMetric } from '@/lib/analytics/types';
import { getRepositories, getSession } from '@/lib/data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.analyticsApp') };
}
export const dynamic = 'force-dynamic';

const eyebrow = 'mb-3 text-xs font-bold tracking-[0.14em] text-muted uppercase';
/** Quadrillage des cartes : chaque `li` est un sous-quadrillage de 3 lignes (voir MetricCard) ; l'espace entre rangées est la marge basse des `li`. */
const grid = 'grid grid-cols-2 gap-x-3 lg:grid-cols-4 -mb-3';
const slot = 'row-span-3 mb-3 grid grid-rows-subgrid';

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const repos = await getRepositories(ctx);
  const raw = await searchParams;

  // La période décide de ce qu'on lit ; les canaux (pour valider ?canal=) se lisent en même temps que les chiffres.
  const today = dayKey(new Date());
  const windows = periodWindows(parseAnalyticsParams(raw, []).days, today);
  const [all, data] = await Promise.all([repos.workspace.integrations(), repos.analytics.load({ from: windows.prevFrom, to: windows.to })]);
  const channels = all.filter((i) => i.status !== 'disabled');

  if (channels.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
        <div className="rounded-[28px] border border-dashed border-line bg-surface px-6 py-14 text-center">
          <h2 className="text-lg font-semibold">{t('app.analytics.empty.title')}</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">{t('app.analytics.empty.text')}</p>
          <ButtonLink href="/app/canaux" variant="primary" className="mt-6">{t('app.analytics.empty.cta')}</ButtonLink>
        </div>
      </div>
    );
  }

  const state = parseAnalyticsParams(raw, channels.map((c) => c.id));
  const view = buildView({ data, channelIds: channels.map((c) => c.id), state, today });
  // La métrique affichée est toujours explicite dans les liens des filtres, pour qu'un changement de canal ou de période la garde.
  const current = { ...state, metric: view.metric };
  const { windows: w, detail } = view;
  const summary = detail.summary;
  const kind = METRIC_KIND[view.metric];
  const fmt = (v: number) => formatMetric(t.locale, view.metric, v);
  const cardFor = (id: CardMetric) => view.cards.find((c) => c.id === id)!;
  const cardHref = (id: CardMetric) => analyticsHref({ ...state, metric: id });
  const metricLabel = t(`app.analytics.metric.${view.metric}`);
  const hasValue = summary.available && summary.value !== null;
  // Un seul canal : pas de filtre, mais on dit de quel canal il s'agit.
  const channel = channels.find((c) => c.id === view.channel) ?? (channels.length === 1 ? channels[0] : undefined);
  const range = t('app.analytics.range', {
    from: formatDayYear(t.locale, w.from), to: formatDayYear(t.locale, w.to), prevFrom: formatDayYear(t.locale, w.prevFrom), prevTo: formatDayYear(t.locale, w.prevTo),
  });

  const stats: { label: string; value: string }[] = !hasValue ? [] : kind === 'ratio'
    ? [
        { label: t('app.analytics.detail.previous'), value: summary.previous === null ? '—' : fmt(summary.previous) },
        { label: t('app.analytics.detail.change'), value: summary.change ? t('app.analytics.card.points', { value: formatSigned(t.locale, summary.change.diff * 100) }) : '—' },
      ]
    : kind === 'stock'
      ? [
          { label: t('app.analytics.detail.start'), value: summary.previous === null ? '—' : fmt(summary.previous) },
          { label: t('app.analytics.detail.change'), value: summary.change ? formatSigned(t.locale, summary.change.diff) : '—' },
          { label: t('app.analytics.detail.changePerDay'), value: detail.average === null ? '—' : formatSigned(t.locale, detail.average) },
        ]
      : [
          { label: t('app.analytics.detail.previous'), value: summary.previous === null ? '—' : fmt(summary.previous) },
          { label: t('app.analytics.detail.perDay'), value: detail.average === null ? '—' : formatAverage(t.locale, detail.average) },
          { label: t('app.analytics.detail.peak'), value: detail.peak ? `${fmt(detail.peak.value)} · ${formatDay(t.locale, detail.peak.day)}` : '—' },
        ];

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <ChannelFilter channels={channels} state={current} t={t} />
        <PeriodFilter state={current} t={t} />
      </div>

      {data.error && <p role="alert" className="rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">{t('app.analytics.notes.error')}</p>}

      <Panel id="summary" title={t('app.analytics.summary.title')} subtitle={`${channel ? `${channel.name} · ` : ''}${range}`}>
        {view.reconnect.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-warn/30 bg-warn-soft px-5 py-4">
            <div className="min-w-0">
              <p className="font-semibold text-warn">{t('app.analytics.scopeNotice.title')}</p>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-warn">
                {t('app.analytics.scopeNotice.text', { channels: view.reconnect.map((id) => channels.find((c) => c.id === id)?.name ?? '').filter(Boolean).join(', ') })}
              </p>
            </div>
            <ButtonLink href="/app/canaux" variant="secondary" size="sm">{t('app.channelsPage.reconnectButton')}</ButtonLink>
          </div>
        )}
        <div className="grid gap-6">
          <div>
            <h3 className={eyebrow}>{t('app.analytics.group.audience')}</h3>
            {view.audience ? (
              <ul className={grid}>
                {AUDIENCE_METRICS.map((id) => <li key={id} className={slot}><MetricCard summary={cardFor(id)} href={cardHref(id)} selected={view.metric === id} t={t} /></li>)}
              </ul>
            ) : (
              <div className="rounded-2xl border border-dashed border-ink/15 bg-surface/60 px-5 py-5">
                <p className="font-semibold">{t('app.analytics.audienceNotice.title')}</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('app.analytics.audienceNotice.text')}</p>
              </div>
            )}
          </div>
          <div>
            <h3 className={eyebrow}>{t('app.analytics.group.activity')}</h3>
            <ul className={grid}>
              {ACTIVITY_METRICS.map((id) => <li key={id} className={slot}><MetricCard summary={cardFor(id)} href={cardHref(id)} selected={view.metric === id} t={t} /></li>)}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        id="detail"
        title={metricLabel}
        subtitle={t(`app.analytics.hint.${view.metric}`)}
        action={hasValue && (
          <div className="flex items-center gap-2.5 sm:flex-col sm:items-end sm:gap-1.5">
            <p className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">{fmt(summary.value!)}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Delta change={summary.change} t={t} lowerIsBetter={LOWER_IS_BETTER.includes(view.metric)} />
              {summary.change && <span>{t('app.analytics.card.vsPrevious')}</span>}
            </div>
          </div>
        )}
      >
        {hasValue ? (
          <div className="grid gap-3">
            <div className={`${tile} p-4 sm:p-5`}>
              <MetricChart days={w.days} values={summary.values} kind={kind === 'flow' ? 'bars' : 'line'} format={fmt} label={metricLabel} total={fmt(summary.value!)} t={t} />
            </div>
            <dl className={`${tile} grid divide-y divide-line sm:divide-x sm:divide-y-0 ${stats.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col-reverse px-4 py-3.5 sm:px-5">
                  <dt className="mt-0.5 text-xs font-medium text-muted">{s.label}</dt>
                  <dd className="text-lg font-semibold tracking-tight tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-ink/15 bg-surface/60 px-5 py-10 text-center">
            <p className="font-semibold">{t('app.analytics.card.noData')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t('app.analytics.detail.noDataText')}</p>
          </div>
        )}
      </Panel>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel id="recent" title={t('app.analytics.recent.title')} subtitle={t('app.analytics.recent.range', { from: formatDayYear(t.locale, w.from), to: formatDayYear(t.locale, w.to) })} className="lg:col-span-2">
          <RecentPosts posts={view.recent} channels={channels} t={t} />
        </Panel>

        <Panel
          id="queue"
          title={t('app.analytics.queue.title')}
          action={<Link href="/app/calendrier" className="text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t('app.analytics.queue.open')}</Link>}
        >
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <Figure label={t('app.analytics.queue.upcoming')} value={formatCount(t.locale, view.queue.upcoming)} />
            <Figure label={t('app.analytics.queue.drafts')} value={formatCount(t.locale, view.queue.drafts)} />
          </dl>
        </Panel>
      </div>

      {channels.length > 1 && (
        <Panel id="performance" title={t('app.analytics.performance.title')} subtitle={t('app.analytics.performance.sorted')}>
          <PerformanceTable table={view.table} channels={channels} selected={view.metric} state={current} t={t} />
        </Panel>
      )}

      <div className="grid gap-1 px-1 text-xs leading-relaxed text-muted">
        <p>{ctx.mode === 'demo' ? t('app.analytics.notes.demo') : t('app.analytics.notes.source')}</p>
        {data.truncated && <p>{t('app.analytics.notes.truncated')}</p>}
      </div>
    </div>
  );
}

/** Un chiffre de la file de publication : le libellé (dt) précède la valeur (dd) dans le code, la valeur s'affiche au-dessus. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${tile} flex flex-col-reverse px-4 py-3.5`}>
      <dt className="mt-1 text-xs leading-snug text-muted">{label}</dt>
      <dd className="text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}
