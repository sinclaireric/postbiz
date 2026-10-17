import { cache } from 'react';
import type { Locale } from '@/i18n/config';
import { CONTENT_DIR, loadPostsFrom } from './load';
import { contentLocaleFor } from './logic';
import type { ContentLocale, Post } from './types';

const postsIn = cache((locale: ContentLocale) => loadPostsFrom(CONTENT_DIR, locale));

/** Articles à afficher pour une langue du site (voir `contentLocaleFor`), le plus récent d'abord. */
export const getPosts = (locale: Locale): Promise<Post[]> => postsIn(contentLocaleFor(locale));

export async function getPost(locale: Locale, slug: string): Promise<Post | undefined> {
  return (await getPosts(locale)).find((p) => p.slug === slug);
}

/** Vrai si le texte de l'article n'est pas dans la langue du site : la page prévient et fixe `lang`/`dir` sur le contenu. */
export const isForeign = (locale: Locale, post: Post) => post.locale !== locale;
