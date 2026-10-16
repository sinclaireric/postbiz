import type { Locale } from './config';
import { LOCALE_META } from './config';

export type Messages = { [key: string]: string | Messages };
export type Params = Record<string, string | number>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Cherche une clé « a.b.c » dans un arbre de messages. */
export function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export interface Translator {
  (key: string, params?: Params): string;
  /** Texte brut du message (balises `<b>…</b>` conservées), pour le rendre avec des composants. */
  raw(key: string, params?: Params): string;
  locale: Locale;
}

/**
 * Traducteur pour une langue. `chain` = arbres de messages par ordre de priorité (langue choisie, puis anglais, puis
 * français) : une clé manquante dans la langue choisie ne casse jamais la page.
 *
 * Pluriels : si `params.count` est un nombre, on cherche `clé_one`, `clé_few`, `clé_other`… selon les règles de la
 * langue (Intl.PluralRules), puis `clé_other`, puis `clé` seule.
 */
export function createTranslator(locale: Locale, chain: Messages[]): Translator {
  const rules = new Intl.PluralRules(LOCALE_META[locale].tag);

  const find = (key: string, params?: Params): string | undefined => {
    const candidates: string[] = [];
    if (typeof params?.count === 'number') candidates.push(`${key}_${rules.select(params.count)}`, `${key}_other`);
    candidates.push(key);
    for (const tree of chain) {
      for (const k of candidates) {
        const found = lookup(tree, k);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  const raw = (key: string, params?: Params) => interpolate(find(key, params) ?? key, params);
  const t = ((key: string, params?: Params) => raw(key, params).replace(/<\/?[a-z]+>/g, '')) as Translator;
  t.raw = raw;
  t.locale = locale;
  return t;
}

/** Clé de base d'un message pluriel : `unread_other` → `unread`. */
export const pluralBase = (key: string) => key.replace(PLURAL_SUFFIX, '');
export const hasPluralSuffix = (key: string) => PLURAL_SUFFIX.test(key);

/** Découpe un message contenant des balises `<nom>texte</nom>` en morceaux (texte brut ou balise). */
export type RichPart = string | { tag: string; text: string };

export function splitRich(message: string): RichPart[] {
  const parts: RichPart[] = [];
  const re = /<([a-z]+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  for (let m = re.exec(message); m; m = re.exec(message)) {
    if (m.index > last) parts.push(message.slice(last, m.index));
    parts.push({ tag: m[1]!, text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return parts;
}
