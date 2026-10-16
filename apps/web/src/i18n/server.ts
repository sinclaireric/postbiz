import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, SOURCE_LOCALE, type Locale } from './config';
import { loadMessages, mergeMessages } from './messages';
import { negotiateLocale } from './negotiate';
import { createTranslator, type Messages } from './translate';
import type { T } from './types';

/** Langue de la requête : choix explicite (cookie), sinon langue du navigateur, sinon anglais. */
export const getLocale = cache(async (): Promise<Locale> => {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return negotiateLocale({ cookie: c.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get('accept-language') });
});

/** Textes de la langue, complétés par l'anglais puis le français si une clé manquait. */
const messagesFor = cache(async (locale: Locale): Promise<Messages[]> => {
  const chain: Locale[] = [locale];
  if (locale !== DEFAULT_LOCALE) chain.push(DEFAULT_LOCALE);
  if (!chain.includes(SOURCE_LOCALE)) chain.push(SOURCE_LOCALE);
  return Promise.all(chain.map(loadMessages));
});

export const getT = cache(async (): Promise<T> => {
  const locale = await getLocale();
  return createTranslator(locale, await messagesFor(locale)) as unknown as T;
});

/** Namespaces jamais utilisés par un composant client : on ne les envoie pas au navigateur. */
const SERVER_ONLY = ['meta', 'legal'];

/** Arbre envoyé au navigateur : la langue, déjà complétée, sans les textes réservés au serveur. */
export async function getClientMessages(locale: Locale): Promise<Messages> {
  const chain = await messagesFor(locale);
  const merged = mergeMessages(...[...chain].reverse());
  for (const ns of SERVER_ONLY) delete merged[ns];
  return merged;
}
