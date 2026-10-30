/**
 * Pays où l'on facture en monnaie locale, avec le rabais de `config.ts`.
 *  - zone CEMAC (XAF) : Cameroun, Gabon, Tchad, Congo-Brazzaville, Centrafrique, Guinée équatoriale ;
 *  - zone UEMOA (XOF) : Sénégal, Côte d'Ivoire, Togo, Bénin, Burkina Faso, Mali, Niger, Guinée-Bissau ;
 *  - RDC : prix en dollars avec le même rabais (monnaie locale hors des francs CFA).
 * Tout autre pays : dollars, sans rabais.
 */

export type PriceCurrency = 'USD' | 'XAF' | 'XOF';
export type Zone = 'xaf' | 'xof' | 'cd' | 'world';

export const XAF_COUNTRIES = ['CM', 'GA', 'TD', 'CG', 'CF', 'GQ'] as const;
export const XOF_COUNTRIES = ['SN', 'CI', 'TG', 'BJ', 'BF', 'ML', 'NE', 'GW'] as const;
export const OTHER_DISCOUNTED_COUNTRIES = ['CD'] as const;
/** Pays proposés dans le sélecteur de pays (l'ordre est celui de la liste). */
export const SELECTABLE_COUNTRIES: readonly string[] = [...XAF_COUNTRIES, ...XOF_COUNTRIES, ...OTHER_DISCOUNTED_COUNTRIES];

/** Code choisi dans le sélecteur pour « tout autre pays » (dollars, sans rabais). */
export const WORLD = 'ZZ';

/** Codes ISO 3166-1 alpha-3, que demande PawaPay (`country`). */
export const ISO3: Record<string, string> = {
  CM: 'CMR', GA: 'GAB', TD: 'TCD', CG: 'COG', CF: 'CAF', GQ: 'GNQ',
  SN: 'SEN', CI: 'CIV', TG: 'TGO', BJ: 'BEN', BF: 'BFA', ML: 'MLI', NE: 'NER', GW: 'GNB', CD: 'COD',
};

/**
 * Pays où le mobile money est actif sur le compte PawaPay de LEFAX au 25 octobre 2026 (lecture de /v2/active-conf). C'est la valeur de repli : en
 * production le site relit la configuration active de PawaPay (`pawapay.ts`), qui fait foi.
 */
export const MOBILE_MONEY_FALLBACK: readonly string[] = ['CM', 'GA', 'CG', 'SN', 'CI', 'BJ', 'BF'];

export interface Region {
  /** Code ISO 3166-1 alpha-2 en majuscules ; `null` si le pays est inconnu. */
  country: string | null;
  zone: Zone;
  currency: PriceCurrency;
  /** Le rabais local s'applique. */
  discounted: boolean;
}

const WORLD_REGION = (country: string | null): Region => ({ country, zone: 'world', currency: 'USD', discounted: false });

export const isCountryCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{2}$/.test(v);

/** Valeurs que les hébergeurs mettent à la place d'un pays quand ils n'en connaissent pas (Cloudflare : XX = inconnu, T1 = Tor). */
const NOT_A_COUNTRY = new Set(['XX', 'T1', 'ZZ', 'AA']);

export function normalizeCountry(v: string | null | undefined): string | null {
  const c = (v ?? '').trim().toUpperCase();
  return isCountryCode(c) && !NOT_A_COUNTRY.has(c) ? c : null;
}

export function regionOf(country: string | null | undefined): Region {
  const c = normalizeCountry(country);
  if (!c) return WORLD_REGION(null);
  if ((XAF_COUNTRIES as readonly string[]).includes(c)) return { country: c, zone: 'xaf', currency: 'XAF', discounted: true };
  if ((XOF_COUNTRIES as readonly string[]).includes(c)) return { country: c, zone: 'xof', currency: 'XOF', discounted: true };
  if ((OTHER_DISCOUNTED_COUNTRIES as readonly string[]).includes(c)) return { country: c, zone: 'cd', currency: 'USD', discounted: true };
  return WORLD_REGION(c);
}

/** Le mobile money est-il proposé dans ce pays ? `enabled` = pays actifs chez PawaPay (par défaut : le repli). */
export function mobileMoneyAvailable(country: string | null | undefined, enabled: readonly string[] = MOBILE_MONEY_FALLBACK): boolean {
  const c = normalizeCountry(country);
  return c !== null && enabled.includes(c);
}

/** Alpha-2 d'après un code alpha-3 de PawaPay (pour lire /v2/active-conf). */
export function iso2From3(iso3: string): string | null {
  const hit = Object.entries(ISO3).find(([, v]) => v === iso3.toUpperCase());
  return hit ? hit[0] : null;
}
