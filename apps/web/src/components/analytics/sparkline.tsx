import { linePaths } from '@/lib/analytics/chart';

const W = 100;
const H = 32;

/** Petite courbe d'une carte : décorative (les valeurs sont dans le graphique et le tableau), donc cachée aux lecteurs d'écran. */
export function Sparkline({ values, level }: { values: readonly (number | null)[]; /** Vrai pour un niveau (abonnés) : échelle du plus bas au plus haut relevé. Sinon un compteur, mesuré depuis zéro. */ level: boolean }) {
  const { line, area } = linePaths(values, { width: W, height: H, pad: 3, fromZero: !level });
  if (!line) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 h-8 w-full overflow-visible" aria-hidden="true" focusable="false">
      <path d={area} className="fill-forest-2/10" />
      <path d={line} fill="none" className="stroke-forest-2" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
