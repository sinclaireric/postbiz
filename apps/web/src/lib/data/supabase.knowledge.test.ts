import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DEMO_CONTEXT } from './demo';
import { createSupabaseRepositories } from './supabase';
import { BETA_KNOWLEDGE_LIMITS } from './types';

// La couche Supabase de la base de connaissance, essayée avec un faux client : ce qu'elle demande à la base, comment elle lit les lignes, et comment elle traduit les refus.
// Les règles elles-mêmes (rôles, plafonds, file de lecture) sont dans les fonctions SQL, testées dans packages/db.

type Step = [method: string, args: unknown[]];
type Reply = { data?: unknown; error?: { message: string; code?: string } | null };

interface Fake {
  supabase: SupabaseClient;
  queries: { table: string; steps: Step[] }[];
  rpcs: { name: string; args: Record<string, unknown> }[];
  removed: { bucket: string; paths: string[] }[];
}

function fake(o: { query?: (table: string, steps: Step[]) => Reply; rpc?: (name: string, args: Record<string, unknown>) => Reply; removeFails?: boolean } = {}): Fake {
  const out: Fake = { supabase: undefined as unknown as SupabaseClient, queries: [], rpcs: [], removed: [] };
  const chain = (table: string) => {
    const steps: Step[] = [];
    out.queries.push({ table, steps });
    const builder: unknown = new Proxy({}, {
      get: (_, method: string) => {
        // `await builder` appelle `then` : la requête « part » à ce moment-là.
        if (method === 'then') return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve({ data: null, error: null, ...o.query?.(table, steps) }).then(resolve, reject);
        return (...args: unknown[]) => (steps.push([method, args]), builder);
      },
    });
    return builder;
  };
  out.supabase = {
    from: chain,
    rpc: async (name: string, args: Record<string, unknown>) => (out.rpcs.push({ name, args }), { data: null, error: null, ...o.rpc?.(name, args) }),
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => (out.removed.push({ bucket, paths }), o.removeFails ? Promise.reject(new Error('stockage en panne')) : Promise.resolve({ data: [], error: null })),
      }),
    },
  } as unknown as SupabaseClient;
  return out;
}

const repo = (f: Fake) => createSupabaseRepositories(f.supabase, DEMO_CONTEXT).knowledge;
const ORG = DEMO_CONTEXT.org.id;
const UUID = '3f2b0b9a-0000-4000-8000-000000000000';
/** Le constructeur de requête a-t-il reçu cet appel (`.eq('org_id', …)`, `.order('updated_at', { ascending: false })`…) ? */
const has = (steps: Step[], method: string, ...args: unknown[]) => steps.some(([m, a]) => m === method && args.every((x, i) => JSON.stringify(a[i]) === JSON.stringify(x)));

describe('knowledge.list : lire les sources de l’organisation', () => {
  const rows = [
    { id: 't1', title: 'Ton de la marque', content: 'Tutoiement.', updated_at: '2026-10-27T10:00:00Z', pinned: true, chunk_count: 1, indexed_at: '2026-10-27T10:00:01Z', embedded_at: null, kind: 'text', status: 'ready' },
    {
      id: 'f1', title: 'Catalogue', content: 'Début du catalogue…', updated_at: '2026-10-27T11:00:00Z', pinned: false, chunk_count: 12, indexed_at: '2026-10-27T11:00:05Z', embedded_at: '2026-10-27T11:00:05Z',
      kind: 'file', status: 'ready', file_path: `${ORG}/${UUID}-catalogue-2026.pdf`, size_bytes: '2048', error: null, stats: { pages: 3, chunks: 12, embedded: true }, synced_at: '2026-10-27T11:00:05Z',
    },
    { id: 'f2', title: 'Scanné', content: '', updated_at: '2026-10-27T12:00:00Z', pinned: false, chunk_count: 0, kind: 'file', status: 'failed', file_path: `${ORG}/${UUID}-scan.pdf`, size_bytes: 4096, error: 'no_text' },
    {
      id: 'w1', title: 'maison-lune.fr', content: 'Maison Lune…', updated_at: '2026-10-27T13:00:00Z', pinned: false, chunk_count: 30, kind: 'website', status: 'processing', url: 'https://www.maison-lune.fr/',
      config: { scope: 'page', autoSync: false }, stats: { total: 4, fetched: 4 }, synced_at: '2026-10-20T13:00:00Z', run_at: '2026-10-27T14:00:00Z', error: 'timeout',
    },
    { id: 'w2', title: 'autre.fr', content: '', updated_at: '2026-10-27T14:00:00Z', kind: 'website', status: 'pending', url: 'https://autre.fr/', config: null },
    { id: 'x1', title: 'Inconnue', content: null, updated_at: '2026-10-27T15:00:00Z', kind: 'inconnu', status: 'étrange', error: 42, size_bytes: null },
  ];

  it('demande les sources de l’organisation, avec les colonnes des documents et des sites, les plus récentes d’abord, sans couper les offres qui gardent plus de 100 sources', async () => {
    const f = fake({ query: () => ({ data: rows }) });
    await repo(f).list();
    const { table, steps } = f.queries[0]!;
    expect(table).toBe('knowledge_items');
    expect(has(steps, 'eq', 'org_id', ORG)).toBe(true);
    expect(has(steps, 'order', 'updated_at', { ascending: false })).toBe(true);
    expect(has(steps, 'limit', 1_000)).toBe(true);
    const columns = String(steps.find(([m]) => m === 'select')![1][0]).split(/,\s*/);
    expect(columns).toEqual(expect.arrayContaining(['kind', 'status', 'url', 'file_path', 'size_bytes', 'error', 'stats', 'config', 'synced_at', 'run_at']));
  });

  it('lit une fiche de texte, un document prêt ou en échec, et un site (nom d’origine du fichier, taille, étendue, relecture)', async () => {
    const items = await repo(fake({ query: () => ({ data: rows }) })).list();
    expect(items.find((k) => k.id === 't1')).toMatchObject({ kind: 'text', status: 'ready', pinned: true, fileName: null, sizeBytes: null, url: null, scope: null, error: null, stats: {} });
    expect(items.find((k) => k.id === 'f1')).toMatchObject({
      kind: 'file', status: 'ready', pinned: false, fileName: 'catalogue-2026.pdf', sizeBytes: 2048, chunkCount: 12, embeddedAt: '2026-10-27T11:00:05Z',
      stats: { pages: 3, chunks: 12, embedded: true }, syncedAt: '2026-10-27T11:00:05Z', scope: null,
    });
    expect(items.find((k) => k.id === 'f2')).toMatchObject({ status: 'failed', error: 'no_text', fileName: 'scan.pdf', sizeBytes: 4096 });
    expect(items.find((k) => k.id === 'w1')).toMatchObject({
      kind: 'website', status: 'processing', url: 'https://www.maison-lune.fr/', scope: 'page', autoSync: false, error: 'timeout', stats: { total: 4, fetched: 4 }, runAt: '2026-10-27T14:00:00Z',
    });
  });

  it('un site sans réglages est lu en entier et relu chaque semaine ; une ligne inattendue devient une fiche de texte prête', async () => {
    const items = await repo(fake({ query: () => ({ data: rows }) })).list();
    expect(items.find((k) => k.id === 'w2')).toMatchObject({ scope: 'site', autoSync: true, status: 'pending', stats: {} });
    expect(items.find((k) => k.id === 'x1')).toMatchObject({ kind: 'text', status: 'ready', content: '', error: null, sizeBytes: null });
  });

  it('une base muette donne une liste vide', async () => {
    expect(await repo(fake({ query: () => ({ data: null }) })).list()).toEqual([]);
  });
});

describe('knowledge.limits : les plafonds de l’offre', () => {
  it('demande knowledge_org_limits pour l’organisation et lit la ligne rendue', async () => {
    const f = fake({ rpc: () => ({ data: [{ files: 20, sites: 3, sources: 100, chunks: 3450, upgradable: true }] }) });
    expect(await repo(f).limits()).toEqual({ sources: 100, files: 20, sites: 3, upgradable: true });
    expect(f.rpcs).toEqual([{ name: 'knowledge_org_limits', args: { p_org: ORG } }]);
  });

  it('lit aussi une ligne seule, et l’offre la plus haute n’est pas à relever', async () => {
    const f = fake({ rpc: () => ({ data: { files: 80, sites: 20, sources: 150, chunks: 15000, upgradable: false } }) });
    expect(await repo(f).limits()).toEqual({ sources: 150, files: 80, sites: 20, upgradable: false });
  });

  it('une panne, une réponse vide ou une base sans la fonction (migration pas appliquée) donnent les plafonds de la bêta', async () => {
    for (const reply of [{ error: { message: 'function public.knowledge_org_limits(uuid) does not exist', code: '42883' } }, { data: [] }, { data: null }, { data: [null] }]) {
      expect(await repo(fake({ rpc: () => reply })).limits(), JSON.stringify(reply)).toEqual(BETA_KNOWLEDGE_LIMITS);
    }
  });

  it('un nombre absurde est remplacé par celui de la bêta, et « relevable » n’est vrai que s’il l’est vraiment', async () => {
    const f = fake({ rpc: () => ({ data: [{ files: 0, sites: -2, sources: 'beaucoup', upgradable: 'oui' }] }) });
    expect(await repo(f).limits()).toEqual({ sources: 100, files: 40, sites: 5, upgradable: false });
    const half = fake({ rpc: () => ({ data: [{ files: 5, sites: 1, sources: 100, upgradable: true }] }) });
    expect(await repo(half).limits()).toEqual({ sources: 100, files: 5, sites: 1, upgradable: true });
  });

  it('rend un nouvel objet à chaque fois : la bêta ne se modifie pas par mégarde', async () => {
    const a = await repo(fake()).limits();
    a.files = 1;
    expect(BETA_KNOWLEDGE_LIMITS.files).toBe(40);
    expect((await repo(fake()).limits()).files).toBe(40);
  });
});

describe('knowledge.create : le plafond de sources', () => {
  it('le refus du déclencheur porte le plafond de l’offre', async () => {
    const f = fake({ query: () => ({ error: { message: 'knowledge_items_limit:150', code: '23514' } }) });
    expect(await repo(f).create({ title: 'Une de plus', content: 'Texte.' })).toEqual({ ok: false, error: { key: 'app.knowledge.errLimit', params: { max: 150 } } });
  });

  it('sans nombre dans le message (base d’avant les offres), le plafond de la bêta', async () => {
    const f = fake({ query: () => ({ error: { message: 'knowledge_items_limit', code: '23514' } }) });
    expect(await repo(f).create({ title: 'Une de plus', content: 'Texte.' })).toEqual({ ok: false, error: { key: 'app.knowledge.errLimit', params: { max: 100 } } });
  });
});

describe('knowledge.addFile / addWebsite / requestSync : les fonctions de la base', () => {
  it('addFile appelle knowledge_add_file avec l’organisation, le chemin, le titre et la taille, et rend l’identifiant', async () => {
    const f = fake({ rpc: () => ({ data: 'k-nouveau' }) });
    expect(await repo(f).addFile({ path: `${ORG}/${UUID}-doc.pdf`, title: 'Doc', size: 2048 })).toEqual({ ok: true, id: 'k-nouveau' });
    expect(f.rpcs).toEqual([{ name: 'knowledge_add_file', args: { p_org: ORG, p_path: `${ORG}/${UUID}-doc.pdf`, p_title: 'Doc', p_size: 2048 } }]);
  });

  it('addWebsite appelle knowledge_add_website avec l’adresse, l’étendue et la relecture', async () => {
    const f = fake({ rpc: () => ({ data: 'k-site' }) });
    expect(await repo(f).addWebsite({ url: 'https://www.maison-lune.fr/', title: 'maison-lune.fr', scope: 'page', autoSync: false })).toEqual({ ok: true, id: 'k-site' });
    expect(f.rpcs).toEqual([{ name: 'knowledge_add_website', args: { p_org: ORG, p_url: 'https://www.maison-lune.fr/', p_title: 'maison-lune.fr', p_scope: 'page', p_auto_sync: false } }]);
  });

  it('requestSync appelle knowledge_request_sync', async () => {
    const f = fake();
    expect(await repo(f).requestSync('k1')).toEqual({ ok: true });
    expect(f.rpcs).toEqual([{ name: 'knowledge_request_sync', args: { p_item: 'k1' } }]);
  });

  it.each([
    ['knowledge_items_limit', { key: 'app.knowledge.errLimit', params: { max: 100 } }],
    ['knowledge_files_limit', { key: 'app.knowledgePage.errors.filesLimit', params: { max: 40 } }],
    ['knowledge_sites_limit', { key: 'app.knowledgePage.errors.sitesLimit', params: { max: 5 } }],
    ['knowledge_daily_limit', { key: 'app.knowledgePage.errors.dailyLimit' }],
    ['knowledge_duplicate', { key: 'app.knowledgePage.errors.duplicate' }],
    ['knowledge_invalid_url', { key: 'app.knowledgePage.errors.invalidUrl' }],
    ['knowledge_invalid_scope', { key: 'app.knowledgePage.errors.invalidUrl' }],
    ['knowledge_file_too_large', { key: 'app.knowledgePage.errors.fileTooLarge', params: { max: 10 } }],
    ['knowledge_unsupported_type', { key: 'app.knowledgePage.errors.unsupportedType' }],
    ['knowledge_file_missing', { key: 'app.knowledgePage.errors.fileMissing' }],
    ['knowledge_invalid_path', { key: 'app.knowledgePage.errors.fileMissing' }],
    ['knowledge_sync_too_soon', { key: 'app.knowledgePage.errors.syncTooSoon' }],
  ])('traduit le refus « %s » en message de formulaire', async (code, expected) => {
    const f = fake({ rpc: () => ({ error: { message: `${code}: détail interne` } }) });
    const r = repo(f);
    const input = { path: `${ORG}/${UUID}-doc.pdf`, title: 'Doc', size: 1 };
    const site = { url: 'https://exemple.fr/', title: 'exemple.fr', scope: 'site' as const, autoSync: true };
    for (const result of [await r.addFile(input), await r.addWebsite(site), await r.requestSync('k1')]) {
      expect(result).toEqual({ ok: false, error: expected });
    }
  });

  it.each([
    ['knowledge_items_limit:150', 'app.knowledge.errLimit', 150],
    ['knowledge_files_limit:20', 'app.knowledgePage.errors.filesLimit', 20],
    ['knowledge_sites_limit:3', 'app.knowledgePage.errors.sitesLimit', 3],
    ['ERREUR knowledge_files_limit:5 (23514)', 'app.knowledgePage.errors.filesLimit', 5],
  ])('un refus de plafond cite celui de l’offre : « %s »', async (message, key, max) => {
    const r = repo(fake({ rpc: () => ({ error: { message } }) }));
    const input = { path: `${ORG}/${UUID}-doc.pdf`, title: 'Doc', size: 1 };
    const site = { url: 'https://exemple.fr/', title: 'exemple.fr', scope: 'site' as const, autoSync: true };
    for (const result of [await r.addFile(input), await r.addWebsite(site), await r.requestSync('k1')]) {
      expect(result).toEqual({ ok: false, error: { key, params: { max } } });
    }
  });

  it('un refus inconnu, une panne ou une réponse vide donnent un message général, jamais le texte de la base', async () => {
    const secret = 'permission denied for table knowledge_items (SQLSTATE 42501)';
    const r = repo(fake({ rpc: () => ({ error: { message: secret } }) }));
    for (const result of [await r.addFile({ path: 'x', title: 'x', size: 1 }), await r.addWebsite({ url: 'x', title: 'x', scope: 'site', autoSync: true }), await r.requestSync('k1')]) {
      expect(result).toEqual({ ok: false, error: { key: 'app.knowledge.errSave' } });
      expect(JSON.stringify(result)).not.toContain('SQLSTATE');
    }
    const empty = repo(fake({ rpc: () => ({ data: null, error: null }) }));
    expect(await empty.addFile({ path: 'x', title: 'x', size: 1 })).toEqual({ ok: false, error: { key: 'app.knowledge.errSave' } });
    expect(await empty.addWebsite({ url: 'x', title: 'x', scope: 'site', autoSync: true })).toEqual({ ok: false, error: { key: 'app.knowledge.errSave' } });
  });
});

describe('knowledge.remove : un document part avec son fichier', () => {
  it('supprime la ligne, puis le fichier du stockage privé', async () => {
    const f = fake({ query: (_t, steps) => (has(steps, 'select') ? { data: { kind: 'file', file_path: `${ORG}/${UUID}-doc.pdf` } } : {}) });
    expect(await repo(f).remove('f1')).toEqual({ ok: true });
    expect(f.queries.some((q) => has(q.steps, 'delete') && has(q.steps, 'eq', 'id', 'f1') && has(q.steps, 'eq', 'org_id', ORG))).toBe(true);
    expect(f.removed).toEqual([{ bucket: 'knowledge', paths: [`${ORG}/${UUID}-doc.pdf`] }]);
  });

  it('une fiche de texte ou un site n’ont pas de fichier à retirer', async () => {
    for (const kind of ['text', 'website']) {
      const f = fake({ query: (_t, steps) => (has(steps, 'select') ? { data: { kind, file_path: null } } : {}) });
      expect(await repo(f).remove('x')).toEqual({ ok: true });
      expect(f.removed).toEqual([]);
    }
    const unknown = fake({ query: () => ({ data: null }) });
    expect(await repo(unknown).remove('fantome')).toEqual({ ok: true });
    expect(unknown.removed).toEqual([]);
  });

  it('un stockage en panne n’empêche pas la suppression (un fichier orphelin n’est pas grave)', async () => {
    const f = fake({ removeFails: true, query: (_t, steps) => (has(steps, 'select') ? { data: { kind: 'file', file_path: `${ORG}/${UUID}-doc.pdf` } } : {}) });
    expect(await repo(f).remove('f1')).toEqual({ ok: true });
    expect(f.removed).toHaveLength(1);
  });

  it('si la suppression échoue en base, le fichier reste', async () => {
    const f = fake({ query: (_t, steps) => (has(steps, 'select') ? { data: { kind: 'file', file_path: `${ORG}/${UUID}-doc.pdf` } } : has(steps, 'delete') ? { error: { message: 'boum' } } : {}) });
    expect(await repo(f).remove('f1')).toEqual({ ok: false, error: { key: 'app.knowledge.errSave' } });
    expect(f.removed).toEqual([]);
  });
});

describe('knowledge.search et knowledge.pages : ce que la base rend', () => {
  const query = { embedding: null, terms: ['livraison'], limit: 6, perItem: 3, exclude: [] as string[] };

  it('search rend l’adresse, le titre de la page et les pages du document que la base a mis dans « meta »', async () => {
    const f = fake({
      rpc: () => ({
        data: [
          { chunk_id: 'c1', item_id: 'w1', title: 'maison-lune.fr', content: 'Livraison offerte.', meta: { heading: 'Livraison', url: 'https://www.maison-lune.fr/livraison', title: 'Livraison · Maison Lune' }, similarity: '0.71', term_hits: 2, score: 0.9 },
          { chunk_id: 'c2', item_id: 'f1', title: 'Catalogue', content: 'Page 3.', meta: { pages: [3, 4] }, similarity: 0.5, term_hits: 1, score: 0.5 },
          { chunk_id: 'c3', item_id: 't1', title: 'FAQ', content: 'Texte.', meta: null, similarity: null, term_hits: null, score: null },
        ],
      }),
    });
    const hits = await repo(f).search(query);
    expect(f.rpcs[0]).toMatchObject({ name: 'knowledge_search', args: { p_org: ORG, p_terms: ['livraison'], p_limit: 6, p_per_item: 3, p_exclude: [] } });
    expect(hits[0]).toEqual({
      chunkId: 'c1', itemId: 'w1', title: 'maison-lune.fr', content: 'Livraison offerte.', heading: 'Livraison', url: 'https://www.maison-lune.fr/livraison', pageTitle: 'Livraison · Maison Lune',
      pages: null, similarity: 0.71, termHits: 2, score: 0.9,
    });
    expect(hits[1]).toMatchObject({ pages: [3, 4], url: null, pageTitle: null, heading: null });
    expect(hits[2]).toMatchObject({ pages: null, url: null, similarity: 0, termHits: 0, score: 0 });
  });

  it('une erreur de la recherche est signalée sans le détail de la base', async () => {
    const f = fake({ rpc: () => ({ error: { message: 'relation "knowledge_chunks" does not exist', code: '42P01' } }) });
    await expect(repo(f).search(query)).rejects.toThrow('knowledge_search : 42P01');
  });

  it('pages rend l’adresse, le titre (à défaut l’adresse) et le nombre de passages de chaque page lue', async () => {
    const f = fake({ rpc: () => ({ data: [{ url: 'https://exemple.fr/', title: 'Accueil', chunks: 3, hash: 'abc' }, { url: 'https://exemple.fr/faq', title: null, chunks: '2' }] }) });
    expect(await repo(f).pages('w1')).toEqual([
      { url: 'https://exemple.fr/', title: 'Accueil', chunks: 3 },
      { url: 'https://exemple.fr/faq', title: 'https://exemple.fr/faq', chunks: 2 },
    ]);
    expect(f.rpcs).toEqual([{ name: 'knowledge_source_pages', args: { p_item: 'w1' } }]);
    expect(await repo(fake()).pages('w1')).toEqual([]);
  });
});
