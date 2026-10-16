import type { Params } from './translate';
import type { Locale } from './config';
import type fr from './messages/fr.json';

type FrMessages = typeof fr;
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
type StripPlural<K extends string> = K extends `${infer B}_${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? B : K;

/** Toutes les clés de message valides, déduites du fichier source en français : une faute de frappe ne compile pas. */
export type MessageKey = StripPlural<Leaves<FrMessages>>;

export interface T {
  (key: MessageKey, params?: Params): string;
  /** Message avec ses balises <b>…</b> : à rendre avec <RichText>. */
  raw(key: MessageKey, params?: Params): string;
  locale: Locale;
}
