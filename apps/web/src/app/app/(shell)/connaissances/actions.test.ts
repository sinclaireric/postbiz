import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/lib/data';
import { DEMO_CONTEXT, demoRepositories } from '@/lib/data/demo';
import { KNOWLEDGE_LIMITS } from '@/lib/data/types';
import { KB } from '@/lib/kb/types';

const state = vi.hoisted(() => ({ session: null as unknown, embedder: null as unknown, revalidated: [] as string[] }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => void state.revalidated.push(path) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }));
vi.mock('@/lib/data', async () => ({ getSession: async () => state.session, getRepositories: async () => (await import('@/lib/data/demo')).demoRepositories }));
vi.mock('@/lib/kb/embed', async (original) => ({ ...(await original<typeof import('@/lib/kb/embed')>()), defaultEmbedder: () => state.embedder }));

const actions = await import('./actions');
const { deleteKnowledgeAction, reindexItemAction, reindexMissingAction, saveKnowledgeAction, searchKnowledgeAction, setPinnedAction } = actions;

const ready = (over: { id?: string; role?: 'admin' | 'member' | 'viewer'; mode?: 'demo' | 'supabase' } = {}): SessionState => ({
  status: 'ready', ctx: { ...DEMO_CONTEXT, mode: over.mode ?? 'demo', user: { ...DEMO_CONTEXT.user, id: over.id ?? 'u-' + Math.random() }, org: { ...DEMO_CONTEXT.org, role: over.role ?? 'admin' } },
});
const form = (fields: Record<string, string>) => Object.entries(fields).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData());
const item = async (title: string) => (await demoRepositories.knowledge.list()).find((k) => k.title === title);
const spyEmbedder = () => {
  const texts: string[][] = [];
  return { texts, embedder: { embed: async (t: string[]) => (texts.push(t), t.map(() => Array.from({ length: 4 }, () => 0.5))) } };
};

beforeEach(() => {
  state.session = ready();
  state.embedder = null;
  state.revalidated = [];
});

describe('saveKnowledgeAction : enregistrer et indexer une fiche', () => {
  it('crée la fiche et l’indexe tout de suite ; la page et le composeur sont rafraîchis', async () => {
    const res = await saveKnowledgeAction({}, form({ title: '  Retours  ', content: 'Retours sous 30 jours.\n\n\n\nLe meuble doit être dans son emballage.' }));
    expect(res.savedAt).toEqual(expect.any(Number));
    expect(res.error).toBeUndefined();
    const saved = (await item('Retours'))!;
    expect(saved).toMatchObject({ content: 'Retours sous 30 jours.\n\nLe meuble doit être dans son emballage.', pinned: true, chunkCount: 1, embeddedAt: null });
    expect(saved.indexedAt).not.toBeNull();
    expect(state.revalidated).toEqual(['/app/connaissances', '/app/calendrier']);
  });

  it('avec un service d’embeddings, les passages sont vectorisés avec le titre pour contexte', async () => {
    const { texts, embedder } = spyEmbedder();
    state.embedder = embedder;
    state.session = ready({ mode: 'supabase' });
    await saveKnowledgeAction({}, form({ title: 'Garanties', content: 'Garantie de 5 ans sur tous nos meubles.' }));
    expect(texts).toEqual([['Garanties\nGarantie de 5 ans sur tous nos meubles.']]);
    expect((await item('Garanties'))!.embeddedAt).not.toBeNull();
  });

  it('en démonstration, aucune IA n’est appelée même si un service d’embeddings existe', async () => {
    const { texts, embedder } = spyEmbedder();
    state.embedder = embedder;
    await saveKnowledgeAction({}, form({ title: 'Démo sans IA', content: 'Texte quelconque.' }));
    expect(texts).toEqual([]);
    expect((await item('Démo sans IA'))!.embeddedAt).toBeNull();
  });

  it('un service d’embeddings en panne n’empêche pas d’enregistrer : la fiche est indexée par ses mots', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.embedder = { embed: async () => { throw new Error('boum'); } };
    state.session = ready({ mode: 'supabase' });
    const res = await saveKnowledgeAction({}, form({ title: 'Malgré la panne', content: 'Le chêne massif vieillit bien.' }));
    expect(res.error).toBeUndefined();
    expect(await item('Malgré la panne')).toMatchObject({ chunkCount: 1, embeddedAt: null });
    log.mockRestore();
  });

  it('modifier une fiche la réindexe avec son nouveau texte', async () => {
    await saveKnowledgeAction({}, form({ title: 'Modifiable', content: 'Ancien texte sur le noyer.' }));
    const before = (await item('Modifiable'))!;
    await saveKnowledgeAction({}, form({ id: before.id, title: 'Modifiable', content: 'Nouveau texte sur le chêne.' }));
    const hits = await demoRepositories.knowledge.search({ embedding: null, terms: ['chêne'], limit: 6, perItem: 3, exclude: [] });
    expect(hits.find((h) => h.itemId === before.id)?.content).toBe('Nouveau texte sur le chêne.');
    expect((await demoRepositories.knowledge.search({ embedding: null, terms: ['noyer'], limit: 6, perItem: 3, exclude: [] })).some((h) => h.itemId === before.id)).toBe(false);
  });

  it('refuse un titre ou un contenu vide ou démesuré, et dit pourquoi', async () => {
    const empty = await saveKnowledgeAction({}, form({ title: '', content: 'x' }));
    expect(empty.error).toContain('app.knowledge.errInvalid');
    expect(empty.savedAt).toBeUndefined();
    const long = await saveKnowledgeAction({}, form({ title: 'x', content: 'y'.repeat(KNOWLEDGE_LIMITS.content + 1) }));
    expect(long.error).toContain('app.knowledge.errInvalid');
  });

  it('un lecteur n’écrit pas ; un visiteur anonyme est renvoyé à la connexion', async () => {
    state.session = ready({ role: 'viewer' });
    expect(await saveKnowledgeAction({}, form({ title: 'Interdit', content: 'x' }))).toEqual({ error: 'app.knowledge.viewerNote' });
    expect(await item('Interdit')).toBeUndefined();
    state.session = { status: 'anonymous' } satisfies SessionState;
    await expect(saveKnowledgeAction({}, form({ title: 'Anonyme', content: 'x' }))).rejects.toThrow('redirect:/login');
  });
});

describe('épingler, réindexer, supprimer', () => {
  it('épingle ou désépingle une fiche (« 1 » épingle, tout le reste désépingle)', async () => {
    await saveKnowledgeAction({}, form({ title: 'À épingler', content: 'Texte.' }));
    const id = (await item('À épingler'))!.id;
    await setPinnedAction(form({ id, pinned: '0' }));
    expect((await item('À épingler'))!.pinned).toBe(false);
    await setPinnedAction(form({ id, pinned: '1' }));
    expect((await item('À épingler'))!.pinned).toBe(true);
    await setPinnedAction(form({ id, pinned: 'oui' }));
    expect((await item('À épingler'))!.pinned).toBe(false);
  });

  it('un lecteur ne change rien', async () => {
    await saveKnowledgeAction({}, form({ title: 'Protégée', content: 'Texte.' }));
    const id = (await item('Protégée'))!.id;
    state.session = ready({ role: 'viewer' });
    await setPinnedAction(form({ id, pinned: '0' }));
    await deleteKnowledgeAction(form({ id }));
    await reindexItemAction(form({ id }));
    expect(await reindexMissingAction()).toBe(0);
    expect(await item('Protégée')).toMatchObject({ pinned: true });
  });

  it('réindexe une fiche, ou toutes celles qui ne le sont pas', async () => {
    const a = (await demoRepositories.knowledge.create({ title: 'Non indexée A', content: 'Premier texte.' })).id!;
    const b = (await demoRepositories.knowledge.create({ title: 'Non indexée B', content: 'Second texte.' })).id!;
    expect((await item('Non indexée A'))!.indexedAt).toBeNull();
    await reindexItemAction(form({ id: a }));
    expect((await item('Non indexée A'))!.chunkCount).toBe(1);
    expect((await item('Non indexée B'))!.indexedAt).toBeNull();
    expect(await reindexMissingAction()).toBeGreaterThanOrEqual(1);
    expect((await item('Non indexée B'))).toMatchObject({ chunkCount: 1 });
    expect(await reindexMissingAction()).toBe(0);
    expect(b).toBeTruthy();
  });

  it('supprime une fiche', async () => {
    await saveKnowledgeAction({}, form({ title: 'À supprimer', content: 'Texte.' }));
    await deleteKnowledgeAction(form({ id: (await item('À supprimer'))!.id }));
    expect(await item('À supprimer')).toBeUndefined();
  });
});

describe('searchKnowledgeAction : tester une question', () => {
  it('rend les passages que l’IA retrouverait, avec leur pertinence ; toutes les fiches sont cherchées, épinglées comprises', async () => {
    const res = await searchKnowledgeAction('Vous êtes ouverts le samedi ? Atelier ouvert ?');
    expect(res).toMatchObject({ ok: true, mode: 'words', found: true });
    if (!res.ok) throw new Error('attendu');
    expect(res.passages[0]).toMatchObject({ title: 'Questions fréquentes', relevant: true, similarity: 0 });
    expect(res.passages[0]!.text).toContain('samedi');
    expect(res.passages.every((p) => p.text.length <= 400)).toBe(true);
    const pinned = await searchKnowledgeAction('ton chaleureux tutoyons clients');
    expect(pinned.ok && pinned.passages.some((p) => p.title === 'Ton de la marque')).toBe(true);
  });

  it('rien de pertinent : « found » faux, les passages faibles restent visibles', async () => {
    const res = await searchKnowledgeAction('partenariat universités');
    expect(res).toMatchObject({ ok: true, found: false });
  });

  it('avec un service d’embeddings, la recherche est hybride', async () => {
    const { texts, embedder } = spyEmbedder();
    state.embedder = embedder;
    state.session = ready({ mode: 'supabase' });
    const res = await searchKnowledgeAction('garantie');
    expect(res).toMatchObject({ ok: true, mode: 'hybrid' });
    expect(texts).toEqual([['garantie']]);
  });

  it('refuse un lecteur, une question vide ou démesurée ; limite les recherches par utilisateur', async () => {
    state.session = ready({ role: 'viewer' });
    expect(await searchKnowledgeAction('garantie')).toEqual({ ok: false, error: 'forbidden' });
    state.session = ready({ id: 'curieux' });
    expect(await searchKnowledgeAction('   ')).toEqual({ ok: false, error: 'invalid' });
    expect(await searchKnowledgeAction(42)).toEqual({ ok: false, error: 'invalid' });
    expect(await searchKnowledgeAction('x'.repeat(KB.queryChars + 1))).toEqual({ ok: false, error: 'invalid' });
    const codes: boolean[] = [];
    for (let i = 0; i < 31; i++) codes.push((await searchKnowledgeAction('garantie')).ok);
    expect(codes.slice(0, 30).every(Boolean)).toBe(true);
    expect(codes[30]).toBe(false);
    state.session = ready({ id: 'patient' });
    expect((await searchKnowledgeAction('garantie')).ok).toBe(true);
  });
});
