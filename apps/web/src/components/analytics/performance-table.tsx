import Link from 'next/link';
import { ChannelAvatar } from '@/components/calendar/channel-avatar';
import type { T } from '@/i18n/types';
import { formatMetric } from '@/lib/analytics/format';
import { analyticsHref, type AnalyticsState, type PerformanceTable as Table } from '@/lib/analytics/logic';
import type { CardMetric } from '@/lib/analytics/types';
import type { IntegrationItem } from '@/lib/data/types';
import { networkName } from '@/lib/networks';
import { tile } from './panel';

const cell = 'px-4 py-3 text-end tabular-nums whitespace-nowrap';

/**
 * Tous les canaux côte à côte, une colonne par métrique. L'en-tête d'une colonne la choisit (comme la carte) et les lignes sont classées selon
 * la colonne choisie ; un clic sur un canal ouvre la vue de ce seul canal. Le tableau défile sur sa largeur sur téléphone, la colonne du canal
 * reste en place. (`contain-paint` : sans lui, Chrome mobile élargit la page à la largeur du tableau.)
 */
export function PerformanceTable({ table, channels, selected, state, t }: { table: Table; channels: IntegrationItem[]; selected: CardMetric; state: AnalyticsState; t: T }) {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const fmt = (m: CardMetric, v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMetric(t.locale, m, v));
  const on = (m: CardMetric) => (m === selected ? 'bg-lime-soft/60' : '');
  return (
    <div className={`${tile} contain-paint overflow-x-auto`}>
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="sticky start-0 z-10 bg-surface px-4 py-3 text-start text-xs font-semibold text-muted">{t('app.analytics.filters.channel')}</th>
            {table.metrics.map((m) => (
              <th key={m} scope="col" aria-sort={m === selected ? 'descending' : undefined} className={`px-4 py-3 text-end text-xs font-semibold ${on(m)}`}>
                <Link
                  href={analyticsHref({ ...state, metric: m })}
                  scroll={false}
                  aria-label={t('app.analytics.performance.show', { metric: t(`app.analytics.metric.${m}`) })}
                  className={`inline-flex min-h-8 items-center justify-end gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${m === selected ? 'text-forest' : 'text-muted hover:text-ink'}`}
                >
                  {t(`app.analytics.metric.${m}`)}
                  {m === selected && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" /></svg>
                  )}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.flatMap((r) => {
            const c = byId.get(r.integrationId);
            if (!c) return [];
            const current = state.channel === c.id;
            return (
              <tr key={c.id} className={`border-b border-line last:border-b-0 ${current ? 'bg-lime-soft' : ''}`}>
                <th scope="row" className={`sticky start-0 z-10 px-4 py-2.5 text-start font-normal ${current ? 'bg-lime-soft' : 'bg-surface'}`}>
                  <Link
                    href={analyticsHref({ ...state, channel: current ? null : c.id })}
                    scroll={false}
                    aria-current={current ? 'true' : undefined}
                    className="flex min-w-44 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    <ChannelAvatar channel={c} size={32} />
                    <span className="min-w-0">
                      <span className="block max-w-48 truncate font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-muted">{networkName(c.networkId)}</span>
                    </span>
                  </Link>
                </th>
                {table.metrics.map((m) => (
                  <td key={m} className={`${cell} ${on(m)} ${m === selected ? 'font-semibold' : ''} ${r.values[m] == null ? 'text-subtle' : ''}`}>{fmt(m, r.values[m])}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-wash">
            <th scope="row" className="sticky start-0 z-10 bg-wash px-4 py-3 text-start text-xs font-semibold tracking-wide text-muted uppercase">{t('app.analytics.performance.total')}</th>
            {table.metrics.map((m) => (
              <td key={m} className={`${cell} font-semibold ${m === selected ? 'bg-lime-soft/60' : ''}`}>{fmt(m, table.total[m])}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
