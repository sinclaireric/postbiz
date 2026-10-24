import type { T } from '@/i18n/types';
import { formatChange, formatSigned } from '@/lib/analytics/format';
import type { Change } from '@/lib/analytics/logic';

const GOOD = 'bg-ok-soft text-ok';
const BAD = 'bg-danger-soft text-danger';
const NEUTRAL = 'bg-black/5 text-muted';
/** Flèches de tendance : montée, descente, stable. */
const ARROW = { up: 'M2 10 5.5 6.5l2 2L12 4M8.75 4H12v3.25', down: 'M2 4l3.5 3.5 2-2L12 10M8.75 10H12V6.75', flat: 'M2.5 7h9' } as const;

/**
 * Variation sur la période, en pastille : flèche, signe et texte masqué (« En hausse ») pour que la couleur ne soit jamais le seul indice.
 * `lowerIsBetter` inverse les couleurs (une hausse des échecs est une mauvaise nouvelle). Un taux varie en points, pas en pourcentage.
 */
export function Delta({ change, t, lowerIsBetter = false, className = '' }: { change: Change | null; t: T; lowerIsBetter?: boolean; className?: string }) {
  if (!change) return null;
  const d = change.direction;
  const tone = d === 'flat' ? NEUTRAL : (d === 'up') !== lowerIsBetter ? GOOD : BAD;
  const text = change.unit === 'points'
    ? d === 'flat' ? t('app.analytics.card.points', { value: '0' }) : t('app.analytics.card.points', { value: formatSigned(t.locale, change.diff * 100) })
    : formatChange(t.locale, change);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums ${tone} ${className}`}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={ARROW[d]} />
      </svg>
      <span className="sr-only">{t(`app.analytics.delta.${d}`)}</span>
      <span dir="ltr">{text}</span>
    </span>
  );
}
