import type { T } from '@/i18n/types';
import { barHeight, linePaths } from '@/lib/analytics/chart';
import { formatDay } from '@/lib/analytics/format';
import type { Day } from '@/lib/analytics/types';

interface Props {
  days: readonly Day[];
  values: readonly (number | null)[];
  /** Nom de la métrique et total (ou dernière valeur), pour la description lue par les lecteurs d'écran. */
  label: string;
  total: string;
  /** Barres pour un flux (une quantité par jour) ; courbe pour un niveau (abonnés) ou un taux. */
  kind: 'bars' | 'line';
  /** Mise en forme d'une valeur dans la langue de la page (nombre, pourcentage…). */
  format: (n: number) => string;
  t: T;
}

/**
 * Graphique d'une métrique, sans bibliothèque : des barres en HTML ou une courbe en SVG. Le graphique est une image décrite par une phrase ;
 * les valeurs exactes jour par jour sont dans le tableau repliable, lisible au clavier, au toucher et par un lecteur d'écran.
 * Le temps va toujours de gauche à droite, même dans les langues qui s'écrivent de droite à gauche.
 */
export function MetricChart({ days, values, label, total, kind, format: fmt, t }: Props) {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return null;
  const known = values.filter((v): v is number => v !== null);
  const hi = Math.max(0, ...known);
  const lo = kind === 'line' ? Math.min(...known) : 0;
  const mid = days[Math.floor((days.length - 1) / 2)]!;
  const date = (d: Day) => formatDay(t.locale, d);

  return (
    <div>
      <div
        dir="ltr"
        role="img"
        aria-label={t('app.analytics.chart.label', { metric: label, total, from: date(first), to: date(last) })}
        className="relative h-48 sm:h-56"
      >
        <div className="absolute inset-0 grid grid-rows-2" aria-hidden="true">
          <div className="border-t border-dashed border-line" />
          <div className="border-t border-dashed border-line" />
        </div>
        <span aria-hidden="true" className="absolute start-0 top-0 z-10 -translate-y-1/2 rounded bg-surface pe-1.5 text-[11px] leading-none text-muted tabular-nums">{fmt(hi)}</span>
        <span aria-hidden="true" className="absolute start-0 bottom-0 z-10 translate-y-1/2 rounded bg-surface pe-1.5 text-[11px] leading-none text-muted tabular-nums">{fmt(lo)}</span>

        {kind === 'bars' ? (
          <div className={`absolute inset-0 flex items-end border-b border-line ${days.length > 45 ? 'gap-px' : 'gap-[3px]'}`}>
            {values.map((v, i) => {
              const n = v ?? 0;
              return (
                <div key={days[i]} title={t('app.analytics.chart.bar', { date: date(days[i]!), value: fmt(n) })} className="flex h-full min-w-0 flex-1 items-end">
                  <span
                    className={`mx-auto block w-full max-w-12 rounded-t-[3px] ${n > 0 ? 'bg-forest-2' : 'bg-line'}`}
                    style={{ height: n > 0 ? `${barHeight(n, hi)}%` : '2px' }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <LinePlot values={values} />
        )}
      </div>

      <div className="mt-3 flex justify-between text-xs text-muted" aria-hidden="true" dir="ltr">
        <span>{date(first)}</span>
        {days.length > 2 && <span>{date(mid)}</span>}
        <span>{date(last)}</span>
      </div>

      <details className="mt-5">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
          {t('app.analytics.chart.table')}
        </summary>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-wash">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-semibold">{t('app.analytics.chart.tableDay')}</th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">{t('app.analytics.chart.tableValue')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => ({ d, v: values[i] ?? null })).reverse().map(({ d, v }) => (
                <tr key={d} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-start font-normal text-muted">{date(d)}</th>
                  <td className="px-4 py-2 text-end tabular-nums">{v === null ? '—' : fmt(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Courbe pleine largeur : le viewBox est étiré, le trait garde son épaisseur (vector-effect). */
function LinePlot({ values }: { values: readonly (number | null)[] }) {
  const { line, area } = linePaths(values, { width: 100, height: 40, pad: 3 });
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true" focusable="false">
      <path d={area} className="fill-forest-2/10" />
      <path d={line} fill="none" className="stroke-forest-2" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
