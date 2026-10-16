import type { Locale } from '../config';
import type { Messages } from '../translate';

/** Chargement à la demande : une requête ne lit que les fichiers de sa langue (+ anglais et français de secours). */
export const LOADERS: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import('./en.json'),
  he: () => import('./he.json'),
  ru: () => import('./ru.json'),
  zh: () => import('./zh.json'),
  fr: () => import('./fr.json'),
  es: () => import('./es.json'),
  pt: () => import('./pt.json'),
  de: () => import('./de.json'),
  it: () => import('./it.json'),
  ja: () => import('./ja.json'),
  ko: () => import('./ko.json'),
  ar: () => import('./ar.json'),
  tr: () => import('./tr.json'),
  vi: () => import('./vi.json'),
};

export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await LOADERS[locale]()).default as Messages;
}

/** Fusionne des arbres : les clés du dernier gagnent. Sert à compléter une langue avec l'anglais puis le français. */
export function mergeMessages(...trees: Messages[]): Messages {
  const out: Messages = {};
  for (const tree of trees) {
    for (const [k, v] of Object.entries(tree)) {
      const cur = out[k];
      out[k] = typeof v === 'string' ? v : mergeMessages(typeof cur === 'object' ? cur : {}, v);
    }
  }
  return out;
}
