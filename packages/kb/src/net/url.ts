import { isIpLiteral } from './ip.ts';

// Les adresses web que Postbiz accepte de lire, et la façon de reconnaître les pages d'un même site.

export type UrlRejection = 'invalid' | 'scheme' | 'credentials' | 'port' | 'address' | 'host';
export type ParsedUrl = { ok: true; url: URL } | { ok: false; reason: UrlRejection };

const MAX_URL = 2_000;
/** Ports permis : ceux du web. Rien d'autre (bases de données, SSH, services internes…). */
const PORTS = new Set(['', '80', '443']);
/** Suffixes de noms qui ne désignent jamais un site public. */
const INTERNAL_SUFFIXES = [
  'localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'test', 'example', 'invalid', 'onion', 'arpa', 'home.arpa',
];

/** Un nom de domaine public : plusieurs étiquettes, caractères usuels, pas de suffixe réservé ni interne. */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.length < 4 || host.length > 253) return false;
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?)+$/.test(host)) return false;
  const labels = host.split('.');
  const tld = labels[labels.length - 1]!;
  if (/^\d+$/.test(tld)) return false; // un « domaine » dont le dernier mot est un nombre est une adresse IP déguisée
  return !INTERNAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/**
 * Valide une adresse web avant de la contacter : http ou https, ni identifiants ni adresse IP, un nom de domaine public, port 80 ou 443. `base` résout une adresse
 * relative (lien d'une page, redirection). Sans schéma (« exemple.fr/page »), `assumeHttps` complète par https://. L'ancre (#…) est retirée.
 * Cette vérification ne suffit pas seule : la résolution DNS est contrôlée à la connexion (voir `safeFetch`).
 */
export function parsePublicUrl(input: string, o: { base?: URL | string; assumeHttps?: boolean } = {}): ParsedUrl {
  let text = input.trim();
  if (!text || text.length > MAX_URL || /[\u0000-\u001F\u007F]/.test(text) || /\s/.test(text)) return { ok: false, reason: 'invalid' };
  if (o.assumeHttps && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) && !text.startsWith('//')) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text, o.base);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (!PORTS.has(url.port)) return { ok: false, reason: 'port' };
  // Le parseur du WHATWG ramène « 2130706433 », « 0x7f.1 » ou « 0177.0.0.1 » à « 127.0.0.1 » : une adresse IP, quelle que soit l'écriture, est refusée.
  if (isIpLiteral(url.hostname)) return { ok: false, reason: 'address' };
  if (!isPublicHostname(url.hostname)) return { ok: false, reason: 'host' };
  url.hash = '';
  url.hostname = url.hostname.replace(/\.$/, '');
  return { ok: true, url };
}

/** Paramètres d'adresse qui ne changent pas la page (suivi publicitaire) : retirés pour reconnaître deux adresses de la même page. */
const TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_gl|ref|ref_src|source|campaign|spm)$/i;
/** Paramètres qui mènent à des listes, recherches ou actions : pas des pages à lire. */
const JUNK_PARAMS = /^(s|search|q|query|replytocom|add-to-cart|orderby|order|sort|filter|filters|page|paged|print|share|lang|currency|variant)$/i;

/** Le nom d'hôte sans « www. » : `www.exemple.fr` et `exemple.fr` sont le même site. */
export const siteHost = (url: URL | string): string => (typeof url === 'string' ? url : url.hostname).toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
export const sameSite = (a: URL, b: URL): boolean => siteHost(a) === siteHost(b);

/** Clé d'une page : sans ancre, sans suivi publicitaire, paramètres triés, sans « / » final (sauf l'accueil), nom d'hôte en minuscules. */
export function pageKey(input: URL): string {
  const url = new URL(input.href);
  url.hash = '';
  url.hostname = url.hostname.replace(/\.$/, '');
  const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);
  let path = url.pathname.replace(/\/{2,}/g, '/');
  path = path.replace(/\/index\.(html?|php|aspx?)$/i, '/');
  if (path.length > 1) path = path.replace(/\/$/, '');
  url.pathname = path;
  return url.href;
}

/** Extensions de fichiers qui ne sont pas des pages web. */
const ASSET_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|ico|svg|tiff?|mp3|mp4|m4a|mov|avi|wmv|webm|wav|ogg|flac|pdf|docx?|xlsx?|pptx?|odt|ods|odp|zip|rar|7z|gz|tgz|tar|bz2|dmg|exe|msi|apk|iso|css|js|mjs|map|json|xml|rss|atom|txt|csv|woff2?|ttf|otf|eot)$/i;
/** Chemins sans intérêt pour une base de connaissance : administration, compte, panier, flux, listes et pagination. */
const JUNK_PATH = /^\/(wp-admin|wp-login\.php|wp-json|wp-content|wp-includes|xmlrpc\.php|feed|comments\/feed|cart|panier|basket|checkout|commande|order|login|log-in|signin|sign-in|connexion|logout|deconnexion|register|signup|inscription|account|my-account|mon-compte|compte|search|recherche|tag|tags|etiquette|author|auteur|cdn-cgi|cgi-bin|admin|administrator|user|users)(\/|$)|\/(feed|amp)\/?$|\/page\/\d+\/?$/i;

/** Une page web à lire : ni fichier, ni chemin d'administration ou de compte, ni liste paginée, ni page de recherche. */
export function isCrawlablePage(url: URL): boolean {
  if (ASSET_EXT.test(url.pathname)) return false;
  if (JUNK_PATH.test(url.pathname)) return false;
  for (const key of url.searchParams.keys()) if (JUNK_PARAMS.test(key)) return false;
  return url.href.length <= 1_000;
}
