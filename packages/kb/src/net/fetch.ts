import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import zlib from 'node:zlib';
import { isPublicIp } from './ip.ts';
import { parsePublicUrl, type ParsedUrl, type UrlRejection } from './url.ts';

// Lire une page web demandée par un utilisateur, sans que le serveur de Postbiz puisse être détourné vers son propre réseau (SSRF).
//
// Les garde-fous, tous dans ce fichier et dans `url.ts` / `ip.ts` :
//  - l'adresse est validée avant chaque requête, redirections comprises (http et https seulement, ports 80 et 443, ni identifiants ni adresse IP, un nom public) ;
//  - la résolution DNS se fait à la connexion même, par la fonction `lookup` de la socket : l'adresse contrôlée est celle à laquelle on se connecte (pas de
//    « DNS rebinding » entre le contrôle et l'envoi), et si une seule des adresses du nom est non publique, la connexion est refusée ;
//  - redirections suivies à la main, cinq au plus, chacune revalidée ; aucun cookie, aucune authentification, une connexion neuve à chaque requête ;
//  - durée totale et taille de la réponse (après décompression) plafonnées ; types de contenu limités.

export type FetchErrorCode =
  | 'invalid_url' | 'blocked_address' | 'dns_failed' | 'unreachable' | 'timeout' | 'tls_error' | 'too_large' | 'redirect_loop' | 'not_html' | 'aborted';

export class FetchError extends Error {
  readonly code: FetchErrorCode;
  constructor(code: FetchErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'FetchError';
    this.code = code;
  }
}

/** Les décisions de sécurité, remplaçables dans les tests (un serveur local, un DNS simulé). La production n'utilise jamais autre chose que `STRICT_POLICY`. */
export interface FetchPolicy {
  parseUrl(input: string, base?: URL | string): ParsedUrl;
  isAllowedIp(ip: string): boolean;
  lookup?(hostname: string): Promise<{ address: string; family: number }[]>;
}

export const STRICT_POLICY: FetchPolicy = {
  parseUrl: (input, base) => parsePublicUrl(input, { base }),
  isAllowedIp: isPublicIp,
};

export interface FetchOptions {
  userAgent: string;
  accept?: string;
  acceptLanguage?: string;
  /** Taille maximale de la réponse, une fois décompressée. */
  maxBytes: number;
  /** Durée totale de chaque requête (connexion, en-têtes et corps). */
  timeoutMs: number;
  /** Redirections suivies au plus (5 par défaut). */
  maxRedirects?: number;
  /** `truncate` (défaut) : une réponse plus grande est coupée à `maxBytes` (`truncated` vaut alors vrai) ; `error` : erreur `too_large`. */
  onOverflow?: 'truncate' | 'error';
  /** Types de contenu admis (sans paramètres), pour les réponses 2xx : un autre type donne l'erreur `not_html` sans lire le corps. */
  contentTypes?: RegExp;
  signal?: AbortSignal;
  policy?: FetchPolicy;
}

export interface FetchResponse {
  /** Adresse de la réponse, après les redirections. */
  url: URL;
  status: number;
  /** Type de contenu en minuscules, sans paramètres (« text/html »), ou ''. */
  contentType: string;
  /** Jeu de caractères annoncé par l'en-tête, en minuscules, ou null. */
  charset: string | null;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** Le corps a été coupé à `maxBytes`. */
  truncated: boolean;
  redirects: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const urlError = (reason: UrlRejection): FetchError => new FetchError(reason === 'address' || reason === 'host' ? 'blocked_address' : 'invalid_url', reason);

class BlockedAddress extends Error {
  readonly code = 'POSTBIZ_BLOCKED_ADDRESS';
}

const defaultLookup = (hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** La fonction `lookup` des sockets : résout le nom et refuse toute adresse non publique, y compris quand le nom en a une publique et une privée. */
function guardedLookup(policy: FetchPolicy): LookupFunction {
  return (hostname, options, callback) => {
    const all = typeof options === 'object' && options !== null && options.all === true;
    const resolve = policy.lookup ?? defaultLookup;
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) as NodeJS.ErrnoException, '', 0);
        if (addresses.some((a) => !policy.isAllowedIp(a.address))) return callback(new BlockedAddress('adresse non publique') as unknown as NodeJS.ErrnoException, '', 0);
        if (all) return (callback as unknown as (err: null, addresses: { address: string; family: number }[]) => void)(null, addresses);
        return callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: unknown) => callback(error as NodeJS.ErrnoException, '', 0),
    );
  };
}

function classify(error: unknown): FetchError {
  if (error instanceof FetchError) return error;
  if (error instanceof BlockedAddress) return new FetchError('blocked_address');
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  if (/^(ENOTFOUND|EAI_AGAIN|EAI_NODATA|EAI_FAIL|EAI_NONAME)$/.test(code)) return new FetchError('dns_failed');
  if (/^(CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_TLS|ERR_SSL|HOSTNAME_MISMATCH|EPROTO)/.test(code)) return new FetchError('tls_error');
  if (/^(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNABORTED)$/.test(code)) return new FetchError('timeout');
  if ((error as { name?: string } | null)?.name === 'AbortError') return new FetchError('aborted');
  return new FetchError('unreachable');
}

interface Once {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
}

/** Une requête, sans suivre les redirections. */
function once(url: URL, o: FetchOptions, policy: FetchPolicy): Promise<Once> {
  return new Promise<Once>((resolve, reject) => {
    if (o.signal?.aborted) return reject(new FetchError('aborted'));
    const onOverflow = o.onOverflow ?? 'truncate';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (abort) o.signal?.removeEventListener('abort', abort);
    };
    const succeed = (value: Once) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.destroy();
      reject(classify(error));
    };

    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      agent: false,
      lookup: guardedLookup(policy),
      headers: {
        'user-agent': o.userAgent,
        accept: o.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': o.acceptLanguage ?? 'fr,en;q=0.8,*;q=0.3',
        'accept-encoding': 'gzip, deflate, br',
        connection: 'close',
      },
    });

    // L'écouteur d'erreurs vient en premier : détruire la requête (délai, annulation) fait lever une erreur « socket hang up » qu'il doit absorber.
    req.on('error', fail);
    timer = setTimeout(() => fail(new FetchError('timeout')), o.timeoutMs);
    if (o.signal) {
      abort = () => fail(new FetchError('aborted'));
      o.signal.addEventListener('abort', abort, { once: true });
    }

    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const headers = res.headers;
      // Redirection, erreur ou réponse sans intérêt : le corps ne sert à rien, on ne le lit pas.
      if (status < 200 || status >= 300) {
        res.resume();
        succeed({ status, headers, body: Buffer.alloc(0), truncated: false });
        req.destroy();
        return;
      }
      const type = String(headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (o.contentTypes && !o.contentTypes.test(type)) return fail(new FetchError('not_html', type));
      const declared = Number(headers['content-length']);
      if (onOverflow === 'error' && Number.isFinite(declared) && declared > o.maxBytes && !headers['content-encoding']) return fail(new FetchError('too_large'));

      const encoding = String(headers['content-encoding'] ?? 'identity').trim().toLowerCase();
      let decoder: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null;
      if (encoding === 'gzip' || encoding === 'x-gzip') decoder = zlib.createGunzip();
      else if (encoding === 'deflate') decoder = zlib.createInflate();
      else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
      else if (encoding !== 'identity' && encoding !== '') return fail(new FetchError('unreachable', `codage non pris en charge : ${encoding}`));

      const chunks: Buffer[] = [];
      let size = 0;
      let rawSize = 0;
      let truncated = false;
      const finish = () => succeed({ status, headers, body: Buffer.concat(chunks, Math.min(size, o.maxBytes)), truncated });
      const take = (chunk: Buffer) => {
        if (settled) return;
        const room = o.maxBytes - size;
        if (chunk.length > room) {
          if (onOverflow === 'error') return fail(new FetchError('too_large'));
          if (room > 0) chunks.push(chunk.subarray(0, room));
          size = o.maxBytes;
          truncated = true;
          finish();
          res.destroy();
          decoder?.destroy();
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      };

      // Le corps compressé est lui aussi plafonné : un flux qui promet des giga-octets n'est pas lu jusqu'au bout.
      res.on('data', (chunk: Buffer) => {
        rawSize += chunk.length;
        if (rawSize > o.maxBytes && onOverflow === 'error') fail(new FetchError('too_large'));
        else if (rawSize > o.maxBytes * 4 + 65_536) {
          // Beaucoup d'octets compressés pour peu de texte : on garde ce qui a été décodé.
          truncated = true;
          finish();
          res.destroy();
          decoder?.destroy();
        }
      });
      res.on('error', (e) => (settled ? undefined : fail(e)));
      if (decoder) {
        decoder.on('data', take);
        decoder.on('end', finish);
        // Un flux compressé coupé net (réponse tronquée par le serveur) : on garde ce qui a été décodé.
        decoder.on('error', (e) => (size > 0 ? finish() : fail(e)));
        res.pipe(decoder);
      } else {
        res.on('data', take);
        res.on('end', finish);
      }
    });
    req.end();
  });
}

/**
 * Lit une adresse web : suit les redirections (en les revalidant), renvoie la réponse, quel que soit son code HTTP (200, 404, 500…). Lève `FetchError` pour ce qui
 * relève du réseau ou de la politique (adresse refusée, DNS, TLS, délai, taille, redirections en boucle, type de contenu non admis).
 */
export async function safeFetch(input: string | URL, o: FetchOptions): Promise<FetchResponse> {
  const policy = o.policy ?? STRICT_POLICY;
  const first = policy.parseUrl(String(input));
  if (!first.ok) throw urlError(first.reason);
  let current = first.url;
  const seen = new Set<string>();
  const limit = o.maxRedirects ?? 5;

  for (let hop = 0; hop <= limit; hop++) {
    if (seen.has(current.href)) throw new FetchError('redirect_loop');
    seen.add(current.href);
    const r = await once(current, o, policy);
    const location = r.headers.location;
    if (REDIRECTS.has(r.status) && typeof location === 'string' && location) {
      const next = policy.parseUrl(location, current);
      if (!next.ok) throw urlError(next.reason);
      current = next.url;
      continue;
    }
    const type = String(r.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    const charset = /charset\s*=\s*["']?([\w:.-]+)/i.exec(String(r.headers['content-type'] ?? ''))?.[1]?.toLowerCase() ?? null;
    return { url: current, status: r.status, contentType: type, charset, headers: r.headers, body: r.body, truncated: r.truncated, redirects: hop };
  }
  throw new FetchError('redirect_loop');
}
