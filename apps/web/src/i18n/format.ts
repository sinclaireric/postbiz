import { LOCALE_META, type Locale } from './config';

const tag = (l: Locale) => LOCALE_META[l].tag;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Ancienneté relative dans la langue : « il y a 5 min », « hier », « 12 oct. »… `style` : « narrow » (« -5 min » dans certaines langues), « long » pour une phrase (« il y a 5 minutes »). */
export function formatRelative(locale: Locale, iso: string, now: Date = new Date(), style: 'narrow' | 'short' | 'long' = 'narrow'): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto', style });
  if (diff < MINUTE) return rtf.format(0, 'second');
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour');
  if (diff < 2 * DAY) return rtf.format(-1, 'day');
  return then.toLocaleDateString(tag(locale), { day: 'numeric', month: 'short' });
}

export const formatTime = (locale: Locale, iso: string) =>
  new Date(iso).toLocaleTimeString(tag(locale), { hour: '2-digit', minute: '2-digit' });

export const formatLongDay = (locale: Locale, d: Date) =>
  d.toLocaleDateString(tag(locale), { weekday: 'long', day: 'numeric', month: 'long' });

export const formatShortDate = (locale: Locale, d: Date) => d.toLocaleDateString(tag(locale), { day: '2-digit', month: '2-digit' });
export const formatFullDate = (locale: Locale, d: Date) => d.toLocaleDateString(tag(locale));
/** Date d'un article (« 1 oct. 2026 », « Oct 1, 2026 »). L'article porte un jour sans heure : on formate en UTC pour ne pas le décaler. */
export const formatArticleDate = (locale: Locale, isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(tag(locale), { dateStyle: 'medium', timeZone: 'UTC' });
export const formatMonthYear = (locale: Locale, d: Date) => d.toLocaleDateString(tag(locale), { month: 'long', year: 'numeric' });
export const formatWeekday = (locale: Locale, d: Date, style: 'long' | 'short' = 'long') => d.toLocaleDateString(tag(locale), { weekday: style });
export const formatDateTime = (locale: Locale, iso: string) => new Date(iso).toLocaleString(tag(locale), { dateStyle: 'full', timeStyle: 'short' });
export const formatNumber = (locale: Locale, n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag(locale), opts).format(n);
export const formatEuro = (locale: Locale, n: number) => new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

/** Taille de fichier : « 5,0 Mo » en français, « 5.0 MB » en anglais… (unités traduites par `units`). */
export function formatBytes(locale: Locale, n: number, units: { b: string; kb: string; mb: string; gb: string }): string {
  const num = (v: number, digits: number) => formatNumber(locale, v, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (n < 1024) return `${num(n, 0)} ${units.b}`;
  if (n < 1024 ** 2) return `${num(n / 1024, 0)} ${units.kb}`;
  if (n < 1024 ** 3) return `${num(n / 1024 ** 2, 1)} ${units.mb}`;
  return `${num(n / 1024 ** 3, 1)} ${units.gb}`;
}
