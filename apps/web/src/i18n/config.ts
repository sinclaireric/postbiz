/**
 * Langues du site, dans l'ordre d'affichage du sélecteur (celui de Postiz).
 * `fr` est la langue source des textes : les autres sont traduites à partir d'elle.
 */
export const LOCALES = ['en', 'he', 'ru', 'zh', 'fr', 'es', 'pt', 'de', 'it', 'ja', 'ko', 'ar', 'tr', 'vi'] as const;
export type Locale = (typeof LOCALES)[number];

export const SOURCE_LOCALE: Locale = 'fr';
/** Langue utilisée quand rien ne correspond (navigateur dans une langue non gérée, par exemple). */
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'postbiz_locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface LocaleMeta {
  /** Nom de la langue dans sa propre langue. */
  name: string;
  dir: 'ltr' | 'rtl';
  /** Code pays du drapeau affiché dans le sélecteur (voir components/flags.tsx). */
  flag: 'gb' | 'il' | 'ru' | 'cn' | 'fr' | 'es' | 'pt' | 'de' | 'it' | 'jp' | 'kr' | 'sa' | 'tr' | 'vn';
  /** Étiquette BCP 47 pour <html lang> et pour Intl (dates, nombres, pluriels). */
  tag: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { name: 'English', dir: 'ltr', flag: 'gb', tag: 'en' },
  he: { name: 'עברית', dir: 'rtl', flag: 'il', tag: 'he' },
  ru: { name: 'русский', dir: 'ltr', flag: 'ru', tag: 'ru' },
  zh: { name: '中文', dir: 'ltr', flag: 'cn', tag: 'zh-Hans' },
  fr: { name: 'français', dir: 'ltr', flag: 'fr', tag: 'fr' },
  es: { name: 'español', dir: 'ltr', flag: 'es', tag: 'es' },
  pt: { name: 'português', dir: 'ltr', flag: 'pt', tag: 'pt' },
  de: { name: 'Deutsch', dir: 'ltr', flag: 'de', tag: 'de' },
  it: { name: 'italiano', dir: 'ltr', flag: 'it', tag: 'it' },
  ja: { name: '日本語', dir: 'ltr', flag: 'jp', tag: 'ja' },
  ko: { name: '한국어', dir: 'ltr', flag: 'kr', tag: 'ko' },
  ar: { name: 'العربية', dir: 'rtl', flag: 'sa', tag: 'ar' },
  tr: { name: 'Türkçe', dir: 'ltr', flag: 'tr', tag: 'tr' },
  vi: { name: 'Tiếng Việt', dir: 'ltr', flag: 'vn', tag: 'vi' },
};

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
