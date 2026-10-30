import { SOURCE_LIMITS, type SourceErrorCode } from '../constants.ts';
import { chunkSource, type Chunk } from '../chunk.ts';
import type { Embedder } from '../embed.ts';
import { decodeText, sniffHtmlCharset } from '../extract/decode.ts';
import { extractHtml, type HtmlPage } from '../extract/html.ts';
import { FetchError, safeFetch, type FetchOptions, type FetchPolicy, type FetchResponse } from '../net/fetch.ts';
import { ALLOW_ALL, parseRobots, type RobotsRules } from '../net/robots.ts';
import { gunzipIfNeeded, parseSitemap } from '../net/sitemap.ts';
import { isCrawlablePage, pageKey, parsePublicUrl, sameSite } from '../net/url.ts';
import { sha256Hex } from '../hash.ts';
import { previewOf, truncate } from '../text.ts';
import type { KnowledgeChunkInput } from '../types.ts';
import { embedBatches } from './embed.ts';
import type { IngestResult } from './file.ts';
import { SourceFailure, TRANSIENT_ERRORS, type SourceStats, type SourceStore } from './types.ts';

// Lire un site web : une page, ou tout le site (jusqu'à 50 pages). On respecte le robots.txt du site, on s'annonce (User-Agent), on espace les requêtes, et on ne lit
// que les pages du même site. Les pages dont le texte n'a pas changé depuis la dernière lecture (même empreinte) ne sont pas revectorisées.
//
// Ordre des pages : la page demandée, puis ses liens (le menu dit ce que le propriétaire juge important), puis le plan du site (sitemap.xml, pages les moins profondes
// d'abord), puis les liens trouvés au fil de la lecture (deux niveaux de profondeur).

export interface SiteJob {
  id: string;
  /** Titre de la source (par défaut le nom du site). */
  title: string;
  url: string;
  scope: 'page' | 'site';
  /** Pages lues au plus (50 par défaut, jamais plus). */
  maxPages?: number;
}

export interface SiteDeps {
  embedder: Embedder | null;
  store: Pick<SourceStore, 'pages' | 'applyPages' | 'touch'>;
  /** Par exemple « PostbizBot/1.0 » : le jeton avant « / » sert à reconnaître nos règles dans robots.txt. */
  userAgent: string;
  /** Remplaçables dans les tests et en démonstration (site simulé). */
  fetch?: (url: string | URL, o: FetchOptions) => Promise<FetchResponse>;
  policy?: FetchPolicy;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  delayMs?: number;
  crawlSeconds?: number;
  log?: (message: string, extra?: unknown) => void;
}

interface Candidate {
  url: URL;
  key: string;
  depth: number;
  isStart: boolean;
}

interface PageBatch {
  key: string;
  title: string;
  hash: string;
  chunks: Chunk[];
}

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)$/;
const BATCH_PAGES = 6;
const MAX_DEPTH = 2;
const SITEMAP_FILES = 5;
const SITEMAP_URLS = 500;
/** Un texte plus court n'est pas une page à garder (page vide, message d'erreur, redirection). */
const MIN_PAGE_CHARS = 60;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const samePath = (a: URL, b: URL) => a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '');

/** Une erreur du client réseau, traduite en code montré à l'utilisateur ; l'annulation (`aborted`) est relancée telle quelle. */
function fromFetchError(error: unknown): SourceFailure {
  if (error instanceof SourceFailure) return error;
  if (error instanceof FetchError) {
    if (error.code === 'aborted') throw error;
    const code: SourceErrorCode = error.code === 'too_large' ? 'internal' : error.code;
    return new SourceFailure(code, { transient: TRANSIENT_ERRORS.has(code), message: error.message });
  }
  return new SourceFailure('internal', { message: error instanceof Error ? error.message : 'erreur inconnue' });
}

/** La réponse d'un site qui n'a pas donné sa page : une panne (à réessayer) ou un refus (à corriger). */
const fromStatus = (status: number): SourceFailure =>
  new SourceFailure('http_error', { transient: status >= 500 || status === 429 || status === 408, message: `HTTP ${status}` });

export async function syncWebsite(deps: SiteDeps, job: SiteJob): Promise<IngestResult> {
  const fetcher = deps.fetch ?? safeFetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const deadline = now() + (deps.crawlSeconds ?? SOURCE_LIMITS.crawlSeconds) * 1_000;
  const agentToken = deps.userAgent.split('/')[0] ?? 'PostbizBot';
  const wholeSite = job.scope === 'site';
  const maxPages = wholeSite ? Math.min(Math.max(job.maxPages ?? SOURCE_LIMITS.sitePages, 1), SOURCE_LIMITS.sitePages) : 1;
  const stats: SourceStats = { fetched: 0, changed: 0, unchanged: 0, failed: 0, removed: 0, robots: 0, spa: 0 };
  const count = (field: 'fetched' | 'changed' | 'unchanged' | 'failed' | 'removed' | 'robots' | 'spa') => {
    stats[field] = (stats[field] ?? 0) + 1;
  };

  const start = (deps.policy?.parseUrl ?? ((input: string) => parsePublicUrl(input)))(job.url);
  if (!start.ok) throw new SourceFailure(start.reason === 'address' || start.reason === 'host' ? 'blocked_address' : 'invalid_url');
  let site = start.url;

  // Politesse : un délai entre deux requêtes (celui que demande le site, s'il est plus long ; au plus 10 s).
  let delay = deps.delayMs ?? SOURCE_LIMITS.crawlDelayMs;
  let lastRequest = Number.NEGATIVE_INFINITY;
  let requests = 0;
  const get = async (url: string | URL, o: Pick<FetchOptions, 'maxBytes' | 'timeoutMs' | 'contentTypes' | 'accept'>): Promise<FetchResponse> => {
    if (deps.signal?.aborted) throw new FetchError('aborted');
    const wait = delay - (now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = now();
    requests++;
    return fetcher(url, { userAgent: deps.userAgent, signal: deps.signal, policy: deps.policy, onOverflow: 'truncate', ...o });
  };
  const pageOptions = { maxBytes: SOURCE_LIMITS.pageBytes, timeoutMs: SOURCE_LIMITS.requestSeconds * 1_000, contentTypes: HTML_TYPES };

  const loadRobots = async (origin: string): Promise<RobotsRules> => {
    let res: FetchResponse;
    try {
      res = await get(`${origin}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: 10_000, accept: 'text/plain,*/*;q=0.5' });
    } catch (error) {
      throw fromFetchError(error);
    }
    if (res.status >= 200 && res.status < 300) {
      const rules = parseRobots(decodeText(res.body, res.charset), agentToken);
      if (rules.crawlDelay !== null) delay = Math.max(delay, Math.min(rules.crawlDelay * 1_000, 10_000));
      return rules;
    }
    // Le site ne sait pas répondre (erreur 5xx) : on ne lit rien tant qu'on ignore ce qu'il permet. Une réponse 4xx veut dire « pas de robots.txt ».
    if (res.status >= 500 || res.status === 429) throw fromStatus(res.status);
    return ALLOW_ALL;
  };

  /** Les adresses du plan du site (robots.txt ou emplacements habituels), pages peu profondes d'abord. */
  const sitemapUrls = async (origin: URL, robots: RobotsRules): Promise<URL[]> => {
    const wanted: string[] = [];
    for (const s of robots.sitemaps) {
      const p = parsePublicUrl(s, { base: origin });
      if (p.ok && sameSite(p.url, origin)) wanted.push(p.url.href);
    }
    if (wanted.length === 0) for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) wanted.push(new URL(path, origin).href);
    const urls: URL[] = [];
    const visited = new Set<string>();
    let files = 0;
    while (wanted.length > 0 && files < SITEMAP_FILES && urls.length < SITEMAP_URLS) {
      if (deps.signal?.aborted || now() > deadline) break;
      const href = wanted.shift()!;
      if (visited.has(href)) continue;
      visited.add(href);
      files++;
      let res: FetchResponse;
      try {
        res = await get(href, { maxBytes: 5 * 1024 * 1024, timeoutMs: 10_000, accept: 'application/xml,text/xml,text/plain,*/*;q=0.5' });
      } catch (error) {
        if (error instanceof FetchError && error.code === 'aborted') throw error;
        continue; // le plan du site est facultatif
      }
      if (res.status < 200 || res.status >= 300) continue;
      const map = parseSitemap(decodeText(gunzipIfNeeded(res.body, 20 * 1024 * 1024), res.charset), SITEMAP_URLS);
      for (const child of map.sitemaps) {
        const p = parsePublicUrl(child, { base: href });
        if (p.ok && sameSite(p.url, origin)) wanted.push(p.url.href);
      }
      for (const entry of map.urls) {
        const p = parsePublicUrl(entry.loc, { base: href });
        if (p.ok && sameSite(p.url, origin) && isCrawlablePage(p.url)) urls.push(p.url);
      }
    }
    const depth = (u: URL) => u.pathname.split('/').filter(Boolean).length;
    return urls.map((u, i) => ({ u, i })).sort((a, b) => depth(a.u) - depth(b.u) || a.i - b.i).map((x) => x.u);
  };

  let robots = await loadRobots(site.origin);
  if (!robots.allows(site.pathname + site.search)) throw new SourceFailure('robots_disallowed');

  const known = await deps.store.pages(job.id);
  // Les passages de la source : ceux des pages déjà lues, auxquels on ajoute et retire au fil de la lecture (le total est plafonné).
  let total = [...known.values()].reduce((n, p) => n + p.chunks, 0);
  let unembedded = [...known.values()].reduce((n, p) => n + (p.chunks - p.embedded), 0);

  const queue: Candidate[] = [];
  const seen = new Set<string>();
  const enqueue = (url: URL, depth: number, isStart = false) => {
    if (!isStart && (!sameSite(url, site) || !isCrawlablePage(url))) return;
    const key = pageKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({ url, key, depth, isStart });
  };
  enqueue(site, 0, true);

  const alive = new Set<string>(); // pages dont le contenu est valable après ce passage (lues ou inchangées)
  const failedKeys = new Set<string>(); // pages en panne passagère : leur ancien contenu reste
  const gone = new Set<string>(); // pages disparues (404, 410) ou plus liées : leur contenu part au prochain envoi
  const batch: PageBatch[] = [];
  let startPreview = '';
  let truncated = false;
  let lastTouch = now();

  /** Écrit les pages en attente (vectorisées d'un coup) et retire celles qui n'existent plus. */
  const flush = async (): Promise<void> => {
    if (batch.length === 0 && gone.size === 0) return;
    const texts = batch.flatMap((p) => p.chunks.map((c) => c.embedText));
    const vectors = await embedBatches(deps.embedder, texts, { signal: deps.signal, wait: deps.sleep });
    let at = 0;
    const chunks: KnowledgeChunkInput[] = [];
    for (const p of batch) {
      for (const c of p.chunks) {
        const embedding = vectors[at++] ?? null;
        if (embedding === null) unembedded++;
        chunks.push({
          content: c.content,
          embedding,
          meta: { url: p.key, title: truncate(p.title, 200), hash: p.hash, ...(c.heading ? { heading: truncate(c.heading, 200) } : {}) },
        });
      }
    }
    // Les pages relues remplacent leurs anciens passages ; celles qui n'existent plus sont retirées (leurs passages ne comptent plus).
    for (const key of gone) {
      const before = known.get(key);
      if (!before) continue;
      count('removed');
      total -= before.chunks;
      unembedded -= before.chunks - before.embedded;
    }
    await deps.store.applyPages(job.id, { chunks, drop: [...new Set([...batch.map((p) => p.key), ...gone])] });
    batch.length = 0;
    gone.clear();
  };

  /** Lit une page. `null` : elle n'est pas à garder. Les erreurs de la page demandée sont fatales, celles des autres sont comptées. */
  const readPage = async (c: Candidate): Promise<{ res: FetchResponse; html: HtmlPage } | null> => {
    let res: FetchResponse;
    try {
      res = await get(c.url, pageOptions);
    } catch (error) {
      if (error instanceof FetchError && error.code === 'not_html' && !c.isStart) return null; // un document, une image : pas une page
      const failure = fromFetchError(error);
      if (c.isStart) throw failure;
      count('failed');
      failedKeys.add(c.key);
      log('page non lue', failure.code);
      return null;
    }
    if (res.status === 404 || res.status === 410) {
      if (c.isStart) throw new SourceFailure('http_error', { message: `HTTP ${res.status}` });
      gone.add(c.key);
      return null;
    }
    if (res.status < 200 || res.status >= 300) {
      if (c.isStart) throw fromStatus(res.status);
      count('failed');
      failedKeys.add(c.key);
      return null;
    }
    if (!c.isStart && !sameSite(res.url, site)) return null; // redirigée hors du site
    count('fetched');
    return { res, html: extractHtml(decodeText(res.body, res.charset ?? sniffHtmlCharset(res.body)), { keepFooter: c.isStart }) };
  };

  while (queue.length > 0 && (stats.fetched ?? 0) < maxPages && requests < maxPages + 20) {
    if (deps.signal?.aborted) throw new FetchError('aborted');
    if (now() > deadline) {
      stats.timeLimit = true;
      break;
    }
    const c = queue.shift()!;
    if (!c.isStart && !robots.allows(c.url.pathname + c.url.search)) {
      count('robots');
      continue;
    }

    const read = await readPage(c);
    if (now() - lastTouch > 5_000) {
      lastTouch = now();
      await deps.store.touch(job.id);
    }
    if (!read) continue;
    const { res, html } = read;

    if (c.isStart) {
      // La page demandée peut aboutir ailleurs (http → https, domaine nu → « www ») : le site est celui où elle a abouti, avec son propre robots.txt.
      if (res.url.origin !== site.origin) {
        site = res.url;
        robots = await loadRobots(site.origin);
        if (!robots.allows(site.pathname + site.search)) throw new SourceFailure('robots_disallowed');
      } else site = res.url;
      if (html.spaLikely) count('spa');
    }

    // L'identité de la page : son adresse après redirection, ou son adresse canonique quand elle désigne la même page (autre paramètre, autre schéma, « www »).
    // Une adresse canonique qui désigne une autre page est ignorée : certains sites déclarent leur accueil pour toutes leurs pages.
    let key = pageKey(res.url);
    if (html.canonical) {
      const canon = parsePublicUrl(html.canonical, { base: res.url });
      if (canon.ok && sameSite(canon.url, site) && samePath(canon.url, res.url)) key = pageKey(canon.url);
    }
    seen.add(key);
    seen.add(c.key);
    if (alive.has(key)) continue; // doublon d'une page déjà lue dans ce passage

    // Les liens de la page (menu compris) : les pages à lire ensuite.
    if (wholeSite && c.depth < MAX_DEPTH) {
      for (const href of html.links) {
        const next = parsePublicUrl(href, { base: res.url });
        if (next.ok) enqueue(next.url, c.depth + 1);
      }
    }
    // Le plan du site, une fois la page demandée lue : ses pages viennent après les liens de la page demandée.
    if (c.isStart && wholeSite) for (const url of await sitemapUrls(site, robots)) enqueue(url, 1);

    if (html.spaLikely) {
      if (!c.isStart) count('spa');
      continue;
    }
    if (html.text.replace(/\s+/g, '').length < MIN_PAGE_CHARS) continue; // pas de texte à garder
    if (c.isStart) startPreview = previewOf(html.text);

    const title = html.title || site.hostname;
    const hash = sha256Hex(`${title}\n${html.text}`);
    const before = known.get(key);
    // Une page dont le texte n'a pas changé n'est pas revectorisée, sauf si ses passages n'ont pas tous leur vecteur et qu'on peut les produire maintenant.
    if (before && before.hash === hash && !(deps.embedder && before.embedded < before.chunks)) {
      count('unchanged');
      alive.add(key);
      continue;
    }
    const room = SOURCE_LIMITS.maxChunks - (total - (before?.chunks ?? 0));
    if (room <= 0) {
      truncated = true;
      break;
    }
    const cut = chunkSource(title, html.text, room);
    if (cut.truncated) truncated = true;
    if (before) unembedded -= before.chunks - before.embedded;
    total += cut.chunks.length - (before?.chunks ?? 0);
    batch.push({ key, title, hash, chunks: cut.chunks });
    alive.add(key);
    count('changed');
    if (batch.length >= BATCH_PAGES) await flush();
  }

  // On s'est arrêté avant d'avoir tout lu (limite de pages) : la source est tronquée.
  if (queue.length > 0 && !stats.timeLimit && !truncated && (stats.fetched ?? 0) >= maxPages) truncated = true;

  // Rien de lisible : un site fait de JavaScript, vide ou en panne. Rien n'est retiré (l'ancien contenu, s'il y en a un, reste).
  if (alive.size === 0) {
    if ((stats.failed ?? 0) > 0 && (stats.spa ?? 0) === 0) throw new SourceFailure('unreachable', { transient: true, stats });
    throw new SourceFailure('empty_site', { stats });
  }

  // Lecture complète (la file est vide : ni limite de pages, ni de durée, ni de passages) : une page connue qu'on n'a pas retrouvée n'existe plus ou n'est plus liée.
  // Sinon, seules les pages disparues (404, 410) sont retirées.
  if (queue.length === 0 && !stats.timeLimit && !truncated && wholeSite) {
    for (const key of known.keys()) if (!alive.has(key) && !failedKeys.has(key)) gone.add(key);
  }
  for (const key of alive) gone.delete(key);
  await flush();

  stats.total = alive.size;
  stats.chunks = total;
  stats.embedded = total > 0 && unembedded <= 0;
  if (truncated) stats.truncated = true;
  if (!stats.timeLimit) delete stats.timeLimit;
  return { chunks: total, embedded: stats.embedded, preview: startPreview, stats };
}
