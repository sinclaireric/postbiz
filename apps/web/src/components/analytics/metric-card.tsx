import Link from 'next/link';
import type { T } from '@/i18n/types';
import { formatMetric } from '@/lib/analytics/format';
import type { MetricSummary } from '@/lib/analytics/logic';
import { LOWER_IS_BETTER, METRIC_KIND } from '@/lib/analytics/types';
import { Delta } from './delta';
import { InfoTip } from './info-tip';
import { Sparkline } from './sparkline';

/**
 * Une métrique : nom, définition (le « i »), valeur de la période, variation en pastille, petite courbe. Choisir la carte change l'adresse
 * (donc la vue se partage et « précédent » la défait) : c'est le nom qui est le lien, étiré sur toute la carte. Le « i » reste un vrai bouton,
 * au-dessus du lien. Sans donnée, la carte le dit au lieu d'afficher un zéro.
 *
 * La carte est un sous-quadrillage de trois lignes (nom, valeur, courbe) : dans une même rangée de cartes, les valeurs restent alignées même
 * quand un nom passe sur deux lignes (« Taux d'engagement »). Le parent doit être un quadrillage où chaque carte occupe 3 lignes.
 */
export function MetricCard({ summary, href, selected, t }: { summary: MetricSummary; href: string; selected: boolean; t: T }) {
  const has = summary.available && summary.value !== null;
  const label = t(`app.analytics.metric.${summary.id}`);
  return (
    <div
      className={`relative row-span-3 grid min-w-0 grid-rows-subgrid rounded-2xl border p-4 transition-colors has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ink sm:p-5 ${selected ? 'border-forest/35 bg-lime-soft shadow-[0_1px_2px_rgba(15,61,46,0.08)]' : 'border-line bg-surface shadow-[0_1px_2px_rgba(17,17,16,0.04)] hover:border-ink/25'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={href}
          scroll={false}
          aria-current={selected ? 'true' : undefined}
          className={`text-sm leading-snug font-medium outline-none after:absolute after:inset-0 after:rounded-2xl ${selected ? 'text-forest' : 'text-muted'}`}
        >
          {label}
        </Link>
        <div className="-me-2 -mt-1.5 shrink-0"><InfoTip label={t('app.analytics.card.info')} text={t(`app.analytics.hint.${summary.id}`)} /></div>
      </div>
      {has ? (
        <>
          <div className="mt-3 flex flex-wrap content-start items-center gap-x-2.5 gap-y-1.5">
            <span className="text-[28px] leading-none font-semibold tracking-tight tabular-nums sm:text-[32px]">{formatMetric(t.locale, summary.id, summary.value!)}</span>
            <Delta change={summary.change} t={t} lowerIsBetter={LOWER_IS_BETTER.includes(summary.id)} />
          </div>
          <Sparkline values={summary.values} level={METRIC_KIND[summary.id] !== 'flow'} />
        </>
      ) : (
        <>
          <span className="mt-3 text-[28px] leading-none font-semibold text-subtle sm:text-[32px]" aria-hidden="true">—</span>
          <span className="mt-2 text-xs text-muted">{t('app.analytics.card.noData')}</span>
        </>
      )}
    </div>
  );
}
