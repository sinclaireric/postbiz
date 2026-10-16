import { DEFAULT_LOCALE, isLocale, type Locale } from './config';

/** Étiquettes de langue que les navigateurs envoient et qui désignent une de nos langues sans porter son code. */
const ALIASES: Record<string, Locale> = {
  iw: 'he', // ancien code de l'hébreu
};

/** Cherche la langue gérée qui correspond à une étiquette (`fr-CA` → `fr`, `zh-TW` → `zh`, `iw` → `he`). */
export function matchTag(tag: string): Locale | null {
  const lower = tag.trim().toLowerCase();
  if (!lower || lower === '*') return null;
  if (isLocale(lower)) return lower;
  const base = lower.split('-')[0]!;
  if (isLocale(base)) return base;
  return ALIASES[base] ?? null;
}

/** Langues demandées par l'en-tête Accept-Language, de la plus à la moins préférée. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: tag!.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((x) => x.tag && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((x) => x.tag);
}

/** Choisit la langue : le choix explicite (cookie) d'abord, puis le navigateur, puis la langue par défaut. */
export function negotiateLocale(opts: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(opts.cookie)) return opts.cookie;
  for (const tag of parseAcceptLanguage(opts.acceptLanguage)) {
    const m = matchTag(tag);
    if (m) return m;
  }
  return DEFAULT_LOCALE;
}
