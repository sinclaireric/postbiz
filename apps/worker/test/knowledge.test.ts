import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeChunkInput } from '@postbiz/kb';
import { FetchError, type FetchOptions, type FetchResponse } from '@postbiz/kb/net';
import { SourceFailure, type IngestResult } from '@postbiz/kb/ingest';
import { createSupabaseKnowledgeDb, LOCK_SECONDS, processKnowledge, retryDelaySeconds, type KnowledgeDb, type KnowledgeDeps, type KnowledgeJob } from '../src/engine/knowledge.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const UA = 'PostbizBot/1.0 (test)';

const fileJob = (o: Partial<KnowledgeJob> = {}): KnowledgeJob => ({
  id: 'k1', orgId: ORG, kind: 'file', title: 'Catalogue', url: null, filePath: `${ORG}/uuid-catalogue.pdf`, config: {}, attempts: 1, chunkCount: 0, ...o,
});
const siteJob = (o: Partial<KnowledgeJob> = {}): KnowledgeJob => ({
  id: 'k2', orgId: ORG, kind: 'website', title: 'exemple.fr', url: 'https://exemple.fr/', filePath: null, config: { scope: 'site', autoSync: true, maxPages: 50 }, attempts: 1, chunkCount: 0, ...o,
});
const result = (o: Partial<IngestResult> = {}): IngestResult => ({ chunks: 3, embedded: true, preview: 'Début du texte', stats: { chunks: 3, embedded: true }, ...o });

function fakeDb(jobs: KnowledgeJob[] = [], o: Partial<KnowledgeDb> = {}) {
  const db: KnowledgeDb = {
    claim: vi.fn(async () => jobs),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    replaceAll: vi.fn(async (_id: string, chunks: KnowledgeChunkInput[]) => chunks.length),
    pages: vi.fn(async () => new Map()),
    applyPages: vi.fn(async (_id: string, o: { chunks: KnowledgeChunkInput[] }) => o.chunks.length),
    touch: vi.fn(async () => {}),
    ...o,
  };
  return db;
}
const deps = (db: KnowledgeDb, o: Partial<KnowledgeDeps> = {}): KnowledgeDeps => ({ db, embedder: null, userAgent: UA, sleep: async () => undefined, ...o });

describe('retryDelaySeconds', () => {
  it('5 minutes, 30 minutes, puis 2 heures', () => {
    expect([1, 2, 3, 4, 0].map(retryDelaySeconds)).toEqual([300, 1_800, 7_200, 7_200, 300]);
  });
});

describe('processKnowledge : une source lue', () => {
  it('un fichier : téléchargé, lu avec son nom, clos sans relecture programmée', async () => {
    const db = fakeDb([fileJob()]);
    const readFile = vi.fn(async () => result());
    const stats = await processKnowledge(deps(db, { readFile }), {});
    expect(db.claim).toHaveBeenCalledWith({ limit: 1, lockSeconds: LOCK_SECONDS });
    expect(db.download).toHaveBeenCalledWith(`${ORG}/uuid-catalogue.pdf`);
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ store: db, embedder: null }), { id: 'k1', title: 'Catalogue', name: 'uuid-catalogue.pdf', bytes: new Uint8Array([1, 2, 3]) });
    expect(db.complete).toHaveBeenCalledWith('k1', { preview: 'Début du texte', stats: { chunks: 3, embedded: true }, nextSeconds: null });
    expect(db.fail).not.toHaveBeenCalled();
    expect(stats).toEqual({ claimed: 1, ready: 1, retry: 0, failed: 0 });
  });

  it('un site : lu avec son étendue, son plafond et le nom du robot ; relu dans une semaine (sauf si on l’a refusé)', async () => {
    const readSite = vi.fn(async () => result({ stats: { fetched: 4 } }));
    const db = fakeDb([siteJob(), siteJob({ id: 'k3', url: 'https://autre.fr', config: { scope: 'page', autoSync: false } })]);
    await processKnowledge(deps(db, { readSite }), { limit: 2 });
    expect(readSite).toHaveBeenNthCalledWith(1, expect.objectContaining({ userAgent: UA, store: db }), { id: 'k2', title: 'exemple.fr', url: 'https://exemple.fr/', scope: 'site', maxPages: 50 });
    expect(readSite).toHaveBeenNthCalledWith(2, expect.anything(), { id: 'k3', title: 'exemple.fr', url: 'https://autre.fr', scope: 'page', maxPages: undefined });
    expect(db.complete).toHaveBeenNthCalledWith(1, 'k2', expect.objectContaining({ nextSeconds: 7 * 86_400 }));
    expect(db.complete).toHaveBeenNthCalledWith(2, 'k3', expect.objectContaining({ nextSeconds: null }));
  });

  it('un site sans réglages de relecture est relu chaque semaine par défaut', async () => {
    const db = fakeDb([siteJob({ config: {} })]);
    await processKnowledge(deps(db, { readSite: vi.fn(async () => result()) }), {});
    expect(db.complete).toHaveBeenCalledWith('k2', expect.objectContaining({ nextSeconds: 7 * 86_400 }));
  });

  it('rien à lire : rien ne se passe', async () => {
    const db = fakeDb([]);
    expect(await processKnowledge(deps(db), {})).toEqual({ claimed: 0, ready: 0, retry: 0, failed: 0 });
    expect(db.complete).not.toHaveBeenCalled();
  });
});

describe('processKnowledge : les échecs', () => {
  it('une erreur définitive est notée telle quelle, avec ses chiffres', async () => {
    const db = fakeDb([siteJob()]);
    const readSite = vi.fn(async () => { throw new SourceFailure('robots_disallowed', { stats: { robots: 1 } }); });
    const stats = await processKnowledge(deps(db, { readSite }), {});
    expect(db.fail).toHaveBeenCalledWith('k2', { error: 'robots_disallowed', transient: false, retrySeconds: 300, stats: { robots: 1 } });
    expect(db.complete).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ ready: 0, retry: 0, failed: 1 });
  });

  it('une panne passagère est réessayée avec un délai qui croît (5 min, 30 min, 2 h), puis abandonnée au troisième essai', async () => {
    const readSite = vi.fn(async () => { throw new SourceFailure('timeout', { transient: true }); });
    const seen: [number, number, boolean][] = [];
    for (const attempts of [1, 2, 3]) {
      const db = fakeDb([siteJob({ attempts })]);
      const stats = await processKnowledge(deps(db, { readSite }), {});
      const call = (db.fail as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { retrySeconds: number; transient: boolean };
      seen.push([attempts, call.retrySeconds, call.transient]);
      expect(stats).toMatchObject(attempts < 3 ? { retry: 1, failed: 0 } : { retry: 0, failed: 1 });
    }
    expect(seen).toEqual([[1, 300, true], [2, 1_800, true], [3, 7_200, true]]);
  });

  it('une erreur inattendue (bogue, base) est notée « internal », à réessayer, sans jamais montrer son texte', async () => {
    const db = fakeDb([fileJob()]);
    const readFile = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); });
    const log = vi.fn();
    await processKnowledge(deps(db, { readFile }), {}, log);
    expect(db.fail).toHaveBeenCalledWith('k1', { error: 'internal', transient: true, retrySeconds: 300, stats: undefined });
    expect(JSON.stringify((db.fail as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('ECONNREFUSED');
  });

  it('l’arrêt du worker (annulation) n’est pas un échec de la source : elle garde son verrou et les autres ne sont pas touchées', async () => {
    const db = fakeDb([siteJob(), fileJob()]);
    const readSite = vi.fn(async () => { throw new FetchError('aborted'); });
    await expect(processKnowledge(deps(db, { readSite }), { limit: 2 })).rejects.toMatchObject({ code: 'aborted' });
    expect(db.fail).not.toHaveBeenCalled();
    expect(db.download).not.toHaveBeenCalled();
  });

  it('un échec n’empêche pas de lire la source suivante, et un échec d’enregistrement de l’échec est seulement journalisé', async () => {
    const db = fakeDb([fileJob({ id: 'a' }), fileJob({ id: 'b' }), fileJob({ id: 'c' })], {
      fail: vi.fn(async (id: string) => { if (id === 'a') throw new Error('base indisponible'); }),
    });
    const readFile = vi.fn(async (_d: unknown, job: { id: string }) => { if (job.id !== 'c') throw new SourceFailure('corrupt'); return result(); });
    const log = vi.fn();
    const stats = await processKnowledge(deps(db, { readFile: readFile as never }), { limit: 3 }, log);
    expect(stats).toMatchObject({ claimed: 3, ready: 1, failed: 1 });
    expect(db.complete).toHaveBeenCalledWith('c', expect.anything());
    expect(log).toHaveBeenCalledWith("enregistrement de l'échec impossible : a", 'base indisponible');
  });
});

describe('processKnowledge : le fichier d’une organisation, et rien d’autre', () => {
  it.each([
    ['dans le dossier d’une autre organisation', '22222222-2222-4222-8222-222222222222/uuid-secret.pdf'],
    ['hors de tout dossier', 'uuid-secret.pdf'],
    ['dans un sous-dossier', `${ORG}/sous/uuid-x.pdf`],
    ['avec une remontée', `${ORG}/../22222222-2222-4222-8222-222222222222/x.pdf`],
    ['vide', ''],
  ])('refuse un fichier %s sans le télécharger', async (_why, filePath) => {
    const db = fakeDb([fileJob({ filePath })]);
    const readFile = vi.fn(async () => result());
    await processKnowledge(deps(db, { readFile }), {});
    expect(db.download).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith('k1', expect.objectContaining({ error: 'file_missing', transient: false }));
  });

  it('un fichier absent du stockage donne file_missing', async () => {
    const db = fakeDb([fileJob()], { download: vi.fn(async () => null) });
    await processKnowledge(deps(db), {});
    expect(db.fail).toHaveBeenCalledWith('k1', expect.objectContaining({ error: 'file_missing', transient: false }));
  });

  it('un site sans adresse donne invalid_url', async () => {
    const db = fakeDb([siteJob({ url: null })]);
    await processKnowledge(deps(db), {});
    expect(db.fail).toHaveBeenCalledWith('k2', expect.objectContaining({ error: 'invalid_url' }));
  });
});

describe('processKnowledge : avec les vrais lecteurs', () => {
  it('lit un fichier texte, le découpe, le vectorise et l’écrit, puis clôt la lecture avec un aperçu', async () => {
    const text = '# Livraison\n\nNous livrons en France et en Belgique sous cinq à sept jours ouvrés après la fabrication de chaque pièce.';
    const db = fakeDb([fileJob({ filePath: `${ORG}/uuid-conditions.md` })], { download: vi.fn(async () => new TextEncoder().encode(text)) });
    const embedder = { embed: vi.fn(async (texts: string[]) => texts.map(() => [0.5, 0.5])) };
    await processKnowledge(deps(db, { embedder }), {});
    expect(db.replaceAll).toHaveBeenCalledTimes(1);
    const [, chunks] = (db.replaceAll as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, KnowledgeChunkInput[]];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ embedding: [0.5, 0.5], meta: { heading: 'Livraison' } });
    expect(embedder.embed.mock.calls[0]![0][0]).toMatch(/^Catalogue > Livraison\n/);
    expect(db.complete).toHaveBeenCalledWith('k1', { preview: expect.stringContaining('Nous livrons en France'), stats: { chunks: 1, embedded: true, truncated: false }, nextSeconds: null });
  });

  it('un fichier que la lecture refuse (type inconnu) est noté tel quel', async () => {
    const db = fakeDb([fileJob({ filePath: `${ORG}/uuid-photo.jpg` })]);
    await processKnowledge(deps(db), {});
    expect(db.fail).toHaveBeenCalledWith('k1', expect.objectContaining({ error: 'unsupported_type', transient: false }));
  });

  it('lit un site : robots.txt, la page, ses passages, puis la clôture avec une relecture hebdomadaire', async () => {
    const page = `<html><head><title>Maison Lune</title></head><body><main><h1>Accueil</h1><p>${'Atelier de mobilier en bois massif fabriqué à la main à Lyon. '.repeat(3)}</p></main></body></html>`;
    const fetch = vi.fn(async (input: string | URL, _o: FetchOptions): Promise<FetchResponse> => {
      const url = new URL(String(input));
      const ok = url.pathname === '/';
      return {
        url, status: ok ? 200 : 404, contentType: 'text/html', charset: 'utf-8', headers: {}, body: Buffer.from(ok ? page : ''), truncated: false, redirects: 0,
      };
    });
    const db = fakeDb([siteJob({ config: { scope: 'page', autoSync: true } })]);
    const stats = await processKnowledge(deps(db, { fetch, delayMs: 0 }), {});
    expect(stats.ready).toBe(1);
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual(['https://exemple.fr/robots.txt', 'https://exemple.fr/']);
    expect(fetch.mock.calls.every(([, o]) => o.userAgent === UA)).toBe(true);
    const [, o] = (db.applyPages as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, { chunks: KnowledgeChunkInput[]; drop: string[] }];
    expect(o.chunks[0]!.meta).toMatchObject({ url: 'https://exemple.fr/', title: 'Maison Lune' });
    expect(db.complete).toHaveBeenCalledWith('k2', expect.objectContaining({ nextSeconds: 7 * 86_400, stats: expect.objectContaining({ fetched: 1, changed: 1, total: 1 }) }));
  });

  it('un site dont l’adresse est interdite (réseau local) n’est jamais contacté', async () => {
    const fetch = vi.fn();
    const db = fakeDb([siteJob({ url: 'http://169.254.169.254/latest/meta-data/' })]);
    await processKnowledge(deps(db, { fetch }), {});
    expect(fetch).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith('k2', expect.objectContaining({ error: 'blocked_address', transient: false }));
  });
});

describe('createSupabaseKnowledgeDb : la base vue par le worker', () => {
  function client(responses: Record<string, { data?: unknown; error?: { message: string } | null }> = {}) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const download = vi.fn(async (_path: string): Promise<{ data: Blob | null; error: { message: string } | null }> => ({ data: new Blob([new Uint8Array([7, 8, 9])]), error: null }));
    const supabase = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: responses[fn]?.data ?? null, error: responses[fn]?.error ?? null };
      }),
      storage: { from: vi.fn(() => ({ download })) },
    };
    return { supabase: supabase as never, calls, download, rpc: supabase.rpc };
  }
  const chunk = (n: number): KnowledgeChunkInput => ({ content: `passage ${n}`, embedding: null, meta: { url: `https://exemple.fr/${n}` } });

  it('claim : une ligne de la base devient une tâche', async () => {
    const { supabase, calls } = client({ claim_knowledge_sources: { data: [
      { id: 'k1', org_id: ORG, kind: 'website', title: 'Site', url: 'https://exemple.fr/', file_path: null, config: { scope: 'page' }, attempts: 2, chunk_count: 5 },
      { id: 'k2', org_id: ORG, kind: 'file', title: 'Doc', url: null, file_path: `${ORG}/x.pdf`, config: null, attempts: 1, chunk_count: 0 },
    ] } });
    const jobs = await createSupabaseKnowledgeDb(supabase).claim({ limit: 3, lockSeconds: 180 });
    expect(calls[0]).toEqual({ fn: 'claim_knowledge_sources', args: { p_limit: 3, p_lock_seconds: 180 } });
    expect(jobs).toEqual([
      { id: 'k1', orgId: ORG, kind: 'website', title: 'Site', url: 'https://exemple.fr/', filePath: null, config: { scope: 'page' }, attempts: 2, chunkCount: 5 },
      { id: 'k2', orgId: ORG, kind: 'file', title: 'Doc', url: null, filePath: `${ORG}/x.pdf`, config: {}, attempts: 1, chunkCount: 0 },
    ]);
  });

  it('écrit les passages par lots de 60 : le premier lot remplace (fichier) ou retire les pages (site), les suivants s’ajoutent', async () => {
    const { supabase, calls } = client({ knowledge_source_write: { data: 130 } });
    const db = createSupabaseKnowledgeDb(supabase);
    expect(await db.replaceAll('k1', Array.from({ length: 130 }, (_, i) => chunk(i)))).toBe(130);
    expect(calls.map((c) => [c.fn, (c.args.p_chunks as unknown[]).length, c.args.p_replace, c.args.p_drop])).toEqual([
      ['knowledge_source_write', 60, true, []], ['knowledge_source_write', 60, false, []], ['knowledge_source_write', 10, false, []],
    ]);
    calls.length = 0;
    await db.applyPages('k2', { chunks: [chunk(1)], drop: ['https://exemple.fr/a'] });
    await db.applyPages('k2', { chunks: [], drop: ['https://exemple.fr/gone'] }); // retrait seul : un appel quand même
    expect(calls.map((c) => [(c.args.p_chunks as unknown[]).length, c.args.p_replace, c.args.p_drop])).toEqual([[1, false, ['https://exemple.fr/a']], [0, false, ['https://exemple.fr/gone']]]);
  });

  it('pages, touch, complete et fail appellent les fonctions de la base avec les bons arguments', async () => {
    const { supabase, calls } = client({ knowledge_source_pages: { data: [{ url: 'https://exemple.fr/', title: 'Accueil', hash: 'h1', chunks: 2, embedded: 1 }] } });
    const db = createSupabaseKnowledgeDb(supabase);
    expect(await db.pages('k2')).toEqual(new Map([['https://exemple.fr/', { hash: 'h1', chunks: 2, embedded: 1 }]]));
    await db.touch('k2');
    await db.complete('k2', { preview: 'Aperçu', stats: { fetched: 1 }, nextSeconds: 604_800 });
    await db.fail('k2', { error: 'timeout', transient: true, retrySeconds: 300, stats: { fetched: 0 } });
    expect(calls.slice(1)).toEqual([
      { fn: 'knowledge_source_touch', args: { p_item: 'k2', p_lock_seconds: LOCK_SECONDS } },
      { fn: 'knowledge_source_complete', args: { p_item: 'k2', p_preview: 'Aperçu', p_stats: { fetched: 1 }, p_next_seconds: 604_800 } },
      { fn: 'knowledge_source_fail', args: { p_item: 'k2', p_error: 'timeout', p_transient: true, p_retry_seconds: 300, p_stats: { fetched: 0 } } },
    ]);
  });

  it('download : les octets du fichier, ou null s’il n’y est pas ; une erreur de la base fait lever l’erreur', async () => {
    const ok = client();
    expect(await createSupabaseKnowledgeDb(ok.supabase).download(`${ORG}/x.pdf`)).toEqual(new Uint8Array([7, 8, 9]));
    expect(ok.download).toHaveBeenCalledWith(`${ORG}/x.pdf`);
    const missing = client();
    missing.download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect(await createSupabaseKnowledgeDb(missing.supabase).download(`${ORG}/absent.pdf`)).toBeNull();
    const broken = client({ claim_knowledge_sources: { error: { message: 'permission denied' } } });
    await expect(createSupabaseKnowledgeDb(broken.supabase).claim({ limit: 1, lockSeconds: 60 })).rejects.toThrow(/claim_knowledge_sources : permission denied/);
  });
});
