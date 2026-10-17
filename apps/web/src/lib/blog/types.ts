import type { Block, Heading } from './markdown';

/** Catégories du blog, dans l'ordre de la barre latérale. Les libellés sont dans les messages (`blog.categories.<id>`). */
export const CATEGORIES = ['agents', 'guides', 'product'] as const;
export type Category = (typeof CATEGORIES)[number];
export const isCategory = (v: unknown): v is Category => typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);

/** Habillage de la couverture générée (pas d'image à fournir pour chaque article). */
export const COVER_THEMES = ['forest', 'lime', 'ink'] as const;
export type CoverTheme = (typeof COVER_THEMES)[number];

/** Auteurs : nom et présentation dans les messages (`blog.authors.<id>`). */
export const AUTHORS = ['team'] as const;
export type AuthorId = (typeof AUTHORS)[number];

/** Les articles sont écrits en français et en anglais ; toutes les autres langues du site affichent l'anglais. */
export const CONTENT_LOCALES = ['fr', 'en'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export interface Post {
  /** Même identifiant dans toutes les langues : c'est le nom du dossier de l'article. */
  slug: string;
  /** Langue du texte affiché (peut différer de celle du site : voir `contentLocaleFor`). */
  locale: ContentLocale;
  title: string;
  description: string;
  /** AAAA-MM-JJ */
  date: string;
  updated?: string;
  category: Category;
  author: AuthorId;
  cover: CoverTheme;
  /** Texte plus court que le titre pour la couverture, si le titre est long. */
  coverTitle?: string;
  minutes: number;
  blocks: Block[];
  /** Titres de niveau 2 : le sommaire. */
  toc: Heading[];
}
