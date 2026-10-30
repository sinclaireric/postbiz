import { normalizeCountry } from './region.ts';

/** Cookie par lequel la personne choisit elle-même son pays (il l'emporte sur toute détection). Valeur : code ISO alpha-2, ou « ZZ » pour tout autre pays. */
export const REGION_COOKIE = 'postbiz_region';
export const REGION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Valeur du cookie → code pays ; « ZZ » (autre pays) est un choix valide qui force les dollars. */
export function parseRegionCookie(v: string | null | undefined): string | null {
  if (v === 'ZZ') return 'ZZ';
  return normalizeCountry(v);
}

type HeadersLike = { get(name: string): string | null };

/** Pays annoncé par l'hébergeur (Vercel : x-vercel-ip-country ; Cloudflare : cf-ipcountry). Absent en local. */
export function countryFromHeaders(h: HeadersLike): string | null {
  return normalizeCountry(h.get('x-vercel-ip-country')) ?? normalizeCountry(h.get('cf-ipcountry'));
}

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i;

/** Adresse du visiteur d'après les en-têtes du relais (première adresse de x-forwarded-for) ; null si elle est absente, mal formée ou privée. */
export function clientIp(h: HeadersLike): string | null {
  const raw = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || '';
  if (!raw || raw.length > 45 || !/^[0-9a-fA-F:.]+$/.test(raw) || PRIVATE_IP.test(raw)) return null;
  return raw;
}

export interface IpLookupOptions {
  fetch?: typeof fetch;
  /** Adresse du service avec « {ip} » à la place de l'adresse du visiteur. Par défaut : GEO_IP_URL, sinon ipwho.is. */
  urlTemplate?: string;
  timeoutMs?: number;
}

export const DEFAULT_GEO_URL = 'https://ipwho.is/{ip}?fields=success,country_code';

/** Pays d'après le corps JSON d'un service de géolocalisation (les services nomment le champ de plusieurs façons). */
export function countryFromLookup(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.success === false) return null;
  for (const k of ['country_code', 'countryCode', 'country']) {
    const c = typeof b[k] === 'string' ? normalizeCountry(b[k] as string) : null;
    if (c) return c;
  }
  return null;
}

const cache = new Map<string, { country: string | null; at: number }>();
const CACHE_MS = 6 * 3_600_000;
const CACHE_MAX = 2_000;
/** Vide la mémoire du résultat par adresse (tests). */
export const clearGeoCache = () => cache.clear();

/**
 * Cherche le pays d'une adresse IP auprès d'un service, depuis le serveur, avec un délai court. Ne lève JAMAIS : toute erreur, tout délai dépassé
 * ou toute réponse inattendue donne `null`, et la page s'affiche avec les prix par défaut. Les résultats sont gardés quelques heures en mémoire
 * (l'adresse ne sert qu'à cette clé, elle n'est ni journalisée ni écrite en base).
 */
export async function lookupCountryByIp(ip: string, opts: IpLookupOptions = {}, now: number = Date.now()): Promise<string | null> {
  const hit = cache.get(ip);
  if (hit && now - hit.at < CACHE_MS) return hit.country;
  const template = opts.urlTemplate ?? process.env.GEO_IP_URL ?? DEFAULT_GEO_URL;
  if (!template.includes('{ip}') || !template.startsWith('https://')) return null;
  const doFetch = opts.fetch ?? fetch;
  let country: string | null = null;
  try {
    const res = await doFetch(template.replace('{ip}', encodeURIComponent(ip)), {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 1_500),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) country = countryFromLookup(await res.json());
  } catch {
    country = null;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(ip, { country, at: now });
  return country;
}

export type CountrySource = 'cookie' | 'host' | 'ip' | 'none';
export interface ResolvedCountry {
  country: string | null;
  source: CountrySource;
}

/**
 * Le pays du visiteur : son choix (cookie) d'abord, puis l'hébergeur, puis, seulement si l'hébergeur ne le dit pas (développement local, autre
 * hébergeur), un service de géolocalisation par adresse IP. Jamais bloquant ; `none` donne les prix en dollars.
 */
export async function resolveCountry(input: { cookie?: string | null; headers: HeadersLike; lookup?: IpLookupOptions }): Promise<ResolvedCountry> {
  const chosen = parseRegionCookie(input.cookie);
  if (chosen) return { country: chosen, source: 'cookie' };
  const host = countryFromHeaders(input.headers);
  if (host) return { country: host, source: 'host' };
  const ip = clientIp(input.headers);
  if (ip) {
    const found = await lookupCountryByIp(ip, input.lookup);
    if (found) return { country: found, source: 'ip' };
  }
  return { country: null, source: 'none' };
}
