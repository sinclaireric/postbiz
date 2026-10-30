// Lecture des documents et des sites web de la base de connaissance : le worker réclame les sources en attente (fichiers déposés par les utilisateurs, sites à lire
// ou à relire chaque semaine), les lit, les découpe en passages, les vectorise et les écrit. Le travail d'une source est fait par `@postbiz/kb` (lecteurs de fichiers,
// client réseau protégé contre le SSRF, découpage, embeddings) ; ce fichier ne fait que le brancher à la base et décider quoi faire des échecs.
//
// Règles :
//  - une source est lue par un seul worker à la fois (verrou posé par claim_knowledge_sources, prolongé pendant les lectures longues) ;
//  - une panne passagère (réseau, site en erreur) remet la source en file avec un délai croissant (5 min, 30 min, 2 h), trois essais au plus ; une erreur définitive
//    (type de fichier, site qui interdit les robots, adresse refusée) est notée telle quelle pour que la page la montre à l'utilisateur ;
//  - une source qui avait déjà des passages les garde quand une relecture échoue ;
//  - un fichier dont le chemin ne commence pas par le dossier de son organisation n'est jamais lu (le worker lit le stockage avec tous les droits).
import type { SupabaseClient } from '@supabase/supabase-js';
import { SOURCE_LIMITS, type KnowledgeChunkInput, type SourceErrorCode } from '@postbiz/kb';
import type { Embedder } from '@postbiz/kb/embed';
import { FetchError, type FetchOptions, type FetchPolicy, type FetchResponse } from '@postbiz/kb/net';
import { ingestFile, SourceFailure, syncWebsite, type IngestResult, type SiteDeps, type SiteJob, type SourceStats, type SourceStore } from '@postbiz/kb/ingest';

export interface KnowledgeJob {
  id: string;
  orgId: string;
  kind: 'file' | 'website';
  title: string;
  url: string | null;
  filePath: string | null;
  config: Record<string, unknown>;
  /** Essais de lecture, celui-ci compris. */
  attempts: number;
  /** Passages déjà écrits par une lecture précédente. */
  chunkCount: number;
}

export interface KnowledgeDb extends SourceStore {
  claim(o: { limit: number; lockSeconds: number }): Promise<KnowledgeJob[]>;
  /** Le contenu d'un fichier du bucket « knowledge », ou null s'il n'y est pas. */
  download(path: string): Promise<Uint8Array | null>;
  complete(id: string, o: { preview: string; stats: SourceStats; nextSeconds: number | null }): Promise<void>;
  fail(id: string, o: { error: SourceErrorCode; transient: boolean; retrySeconds: number; stats?: SourceStats }): Promise<void>;
}

export interface KnowledgeStats {
  claimed: number;
  ready: number;
  retry: number;
  failed: number;
}

export interface KnowledgeDeps {
  db: KnowledgeDb;
  /** Sans service d'embeddings (pas de clé d'API) : passages écrits sans vecteur, cherchables par leurs mots. */
  embedder: Embedder | null;
  userAgent: string;
  signal?: AbortSignal;
  /** Remplaçables dans les tests. */
  fetch?: (url: string | URL, o: FetchOptions) => Promise<FetchResponse>;
  policy?: FetchPolicy;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  delayMs?: number;
  readFile?: typeof ingestFile;
  readSite?: (deps: SiteDeps, job: SiteJob) => Promise<IngestResult>;
}

/** Délai avant de réessayer après une panne passagère : 5 minutes, 30 minutes, 2 heures. */
export const retryDelaySeconds = (attempts: number): number => [300, 1_800, 7_200][Math.min(Math.max(attempts, 1), 3) - 1]!;
export const LOCK_SECONDS = 180;

export async function processKnowledge(
  deps: KnowledgeDeps,
  o: { limit?: number } = {},
  log: (msg: string, extra?: unknown) => void = () => {},
): Promise<KnowledgeStats> {
  const { db } = deps;
  const stats: KnowledgeStats = { claimed: 0, ready: 0, retry: 0, failed: 0 };
  const jobs = await db.claim({ limit: o.limit ?? 1, lockSeconds: LOCK_SECONDS });
  stats.claimed = jobs.length;

  // Une source à la fois : un site se lit poliment, au rythme du site, et un gros PDF occupe déjà le processus.
  for (const job of jobs) {
    try {
      const result = job.kind === 'file' ? await readFile(deps, job) : await readWebsite(deps, job);
      const autoSync = job.kind === 'website' && job.config.autoSync !== false;
      await db.complete(job.id, { preview: result.preview, stats: result.stats, nextSeconds: autoSync ? SOURCE_LIMITS.autoSyncDays * 86_400 : null });
      stats.ready++;
      log(`source lue : ${job.kind} ${job.id}`, { chunks: result.chunks, embedded: result.embedded });
    } catch (error) {
      // L'arrêt du worker : la source garde son verrou (elle sera reprise à son expiration) ; rien à noter.
      if (error instanceof FetchError && error.code === 'aborted') throw error;
      const failure = error instanceof SourceFailure ? error : new SourceFailure('internal', { transient: true, message: error instanceof Error ? error.message : String(error) });
      // Le détail reste dans les journaux (jamais le contenu d'une page ou d'un fichier), l'utilisateur ne reçoit qu'un code.
      log(`source en échec : ${job.kind} ${job.id}`, { code: failure.code, transient: failure.transient, attempt: job.attempts, message: failure.message });
      try {
        await db.fail(job.id, { error: failure.code, transient: failure.transient, retrySeconds: retryDelaySeconds(job.attempts), stats: failure.stats });
        if (failure.transient && job.attempts < 3) stats.retry++;
        else stats.failed++;
      } catch (inner) {
        // Si même l'enregistrement de l'échec échoue, le verrou expire et la source sera reprise.
        log(`enregistrement de l'échec impossible : ${job.id}`, inner instanceof Error ? inner.message : String(inner));
      }
    }
  }
  return stats;
}

async function readFile(deps: KnowledgeDeps, job: KnowledgeJob): Promise<IngestResult> {
  const path = job.filePath ?? '';
  // Le chemin est celui de l'organisation de la source, directement dans son dossier : sinon on ne lit rien (un fichier d'une autre organisation n'a pas à se retrouver ici).
  if (!path.startsWith(`${job.orgId}/`) || path.includes('..') || path.slice(job.orgId.length + 1).includes('/')) throw new SourceFailure('file_missing');
  const bytes = await deps.db.download(path);
  if (!bytes) throw new SourceFailure('file_missing');
  const name = path.slice(job.orgId.length + 1);
  return (deps.readFile ?? ingestFile)({ embedder: deps.embedder, store: deps.db, signal: deps.signal, wait: deps.sleep }, { id: job.id, title: job.title, name, bytes });
}

async function readWebsite(deps: KnowledgeDeps, job: KnowledgeJob): Promise<IngestResult> {
  if (!job.url) throw new SourceFailure('invalid_url');
  const scope = job.config.scope === 'page' ? 'page' : 'site';
  const maxPages = typeof job.config.maxPages === 'number' ? job.config.maxPages : undefined;
  return (deps.readSite ?? syncWebsite)(
    {
      embedder: deps.embedder, store: deps.db, userAgent: deps.userAgent, signal: deps.signal, fetch: deps.fetch, policy: deps.policy, sleep: deps.sleep, now: deps.now, delayMs: deps.delayMs,
    },
    { id: job.id, title: job.title, url: job.url, scope, maxPages },
  );
}

type Row = Record<string, any>;

/** Au plus 60 passages par appel : un passage vectorisé pèse une dizaine de Ko en JSON. */
const WRITE_BATCH = 60;

export function createSupabaseKnowledgeDb(supabase: SupabaseClient): KnowledgeDb {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what} : ${error.message}`);
  };
  /** Écrit des passages par lots : le premier lot porte le remplacement ou le retrait des pages, les suivants s'ajoutent. */
  const write = async (itemId: string, chunks: KnowledgeChunkInput[], replace: boolean, drop: string[]): Promise<number> => {
    let total = 0;
    for (let at = 0; at === 0 || at < chunks.length; at += WRITE_BATCH) {
      const first = at === 0;
      const { data, error } = await supabase.rpc('knowledge_source_write', {
        p_item: itemId,
        p_chunks: chunks.slice(at, at + WRITE_BATCH),
        p_replace: first && replace,
        p_drop: first ? drop : [],
      });
      check(error, 'knowledge_source_write');
      total = Number(data ?? 0);
    }
    return total;
  };

  return {
    async claim(o) {
      const { data, error } = await supabase.rpc('claim_knowledge_sources', { p_limit: o.limit, p_lock_seconds: o.lockSeconds });
      check(error, 'claim_knowledge_sources');
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id, orgId: r.org_id, kind: r.kind === 'website' ? 'website' : 'file', title: r.title, url: r.url ?? null, filePath: r.file_path ?? null,
        config: (r.config ?? {}) as Record<string, unknown>, attempts: Number(r.attempts ?? 1), chunkCount: Number(r.chunk_count ?? 0),
      }));
    },
    async download(path) {
      const { data, error } = await supabase.storage.from('knowledge').download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    replaceAll: (itemId, chunks) => write(itemId, chunks, true, []),
    applyPages: (itemId, o) => write(itemId, o.chunks, false, o.drop),
    async pages(itemId) {
      const { data, error } = await supabase.rpc('knowledge_source_pages', { p_item: itemId });
      check(error, 'knowledge_source_pages');
      return new Map(((data ?? []) as Row[]).map((r) => [r.url as string, { hash: String(r.hash ?? ''), chunks: Number(r.chunks ?? 0), embedded: Number(r.embedded ?? 0) }]));
    },
    async touch(itemId) {
      const { error } = await supabase.rpc('knowledge_source_touch', { p_item: itemId, p_lock_seconds: LOCK_SECONDS });
      check(error, 'knowledge_source_touch');
    },
    async complete(id, o) {
      const { error } = await supabase.rpc('knowledge_source_complete', { p_item: id, p_preview: o.preview, p_stats: o.stats, p_next_seconds: o.nextSeconds });
      check(error, 'knowledge_source_complete');
    },
    async fail(id, o) {
      const { error } = await supabase.rpc('knowledge_source_fail', {
        p_item: id, p_error: o.error, p_transient: o.transient, p_retry_seconds: o.retrySeconds, p_stats: o.stats ?? null,
      });
      check(error, 'knowledge_source_fail');
    },
  };
}
