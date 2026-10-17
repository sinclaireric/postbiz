import type { Locale } from '@/i18n/config';
import type { Category, ContentLocale, Post } from './types';

/** Langue du texte d'un article pour une langue du site : français pour le français, anglais pour toutes les autres. */
export const contentLocaleFor = (locale: Locale): ContentLocale => (locale === 'fr' ? 'fr' : 'en');

/** Les langues sans article traduit affichent l'anglais : la page le signale. */
export const noticeNeeded = (locale: Locale) => locale !== 'fr' && locale !== 'en';

export const PER_PAGE = 12;

/** Temps de lecture : environ 220 mots par minute, une minute au minimum. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 220));
export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function paginate<T>(items: T[], page: number, perPage = PER_PAGE): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * perPage, current * perPage), page: current, pages, total: items.length };
}

/** Numéro de page lu dans l'adresse (`?page=2`) : entier positif, 1 si absent ou invalide. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = raw && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 ? n : 1;
}

/** Texte de recherche sans accents ni majuscules : « Fenêtre » trouve « fenetre ». */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

/** Articles contenant tous les mots de la recherche, dans le titre ou la description. */
export function searchPosts(posts: Post[], query: string): Post[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return posts;
  return posts.filter((p) => {
    const haystack = fold(`${p.title} ${p.description}`);
    return words.every((w) => haystack.includes(w));
  });
}

export const inCategory = (posts: Post[], category: Category | undefined) => (category ? posts.filter((p) => p.category === category) : posts);

/** Plus récent d'abord ; à date égale, l'ordre alphabétique de l'identifiant garde un classement stable. */
export const byDateDesc = (a: Post, b: Post) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1);

/** Articles à lire ensuite : d'abord la même catégorie, puis les plus récents. Jamais l'article courant. */
export function relatedPosts(posts: Post[], current: Post, count = 3): Post[] {
  const others = posts.filter((p) => p.slug !== current.slug).sort(byDateDesc);
  const same = others.filter((p) => p.category === current.category);
  return [...same, ...others.filter((p) => p.category !== current.category)].slice(0, count);
}

/** Valeur de `?q=` nettoyée : une chaîne, sans espaces superflus, bornée. */
export function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

/** Adresse d'une liste du blog : `/blog`, `/blog/category/guides`, avec `?q=` et `?page=` quand ils comptent. */
export function listHref(opts: { category?: Category; q?: string; page?: number }): string {
  const base = opts.category ? `/blog/category/${opts.category}` : '/blog';
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
