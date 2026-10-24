import { LOCALE_META, type Locale } from '@/i18n/config';
import type { Change } from './logic';
import type { CardMetric, Day } from './types';

const tag = (l: Locale) => LOCALE_META[l].tag;

/** Les grands nombres passent en notation courte (« 12,5 k ») à partir de 100 000 pour tenir dans une carte. */
export function formatCount(locale: Locale, n: number): string {
  const compact = Math.abs(n) >= 100_000;
  return new Intl.NumberFormat(tag(locale), compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }).format(n);
}

/** Moyenne par jour : une décimale tant que la valeur est petite (« 0,7 »), puis un entier. */
export function formatAverage(locale: Locale, n: number): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0 }).format(n);
}

/** Variation avec son signe : « +12 % », « −3 % », « 0 % » ; sans base de comparaison (période précédente à zéro), l'écart brut « +5 ». */
export function formatChange(locale: Locale, change: Change): string {
  if (change.direction === 'flat') return change.percent === null ? '0' : new Intl.NumberFormat(tag(locale), { style: 'percent' }).format(0);
  if (change.percent === null) return new Intl.NumberFormat(tag(locale), { signDisplay: 'exceptZero', maximumFractionDigits: 0 }).format(change.diff);
  const p = Math.abs(change.percent);
  return new Intl.NumberFormat(tag(locale), { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: p < 0.1 ? 1 : 0 }).format(change.percent);
}

/** Écart signé (« +212 »). */
export const formatSigned = (locale: Locale, n: number): string =>
  new Intl.NumberFormat(tag(locale), { signDisplay: 'exceptZero', maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0 }).format(n);

/** « 3 oct. » : le jour est un jour UTC, formaté en UTC pour ne pas glisser d'un jour selon le fuseau du serveur. */
export const formatDay = (locale: Locale, day: Day): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(tag(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** « 3 oct. 2026 » : pour les bornes des périodes, où l'année évite toute ambiguïté. */
export const formatDayYear = (locale: Locale, day: Day): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(tag(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** La valeur d'une métrique comme on l'affiche : un taux en pourcentage (« 6,6 % »), le reste en nombre. */
export function formatMetric(locale: Locale, metric: CardMetric, value: number): string {
  if (metric === 'engagementRate') return new Intl.NumberFormat(tag(locale), { style: 'percent', maximumFractionDigits: 1 }).format(value);
  return formatCount(locale, value);
}
