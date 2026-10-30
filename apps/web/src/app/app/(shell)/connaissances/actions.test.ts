import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const {
  addWebsiteAction, deleteKnowledgeAction, listPagesAction, registerDocumentAction, reindexItemAction, reindexMissingAction, requestSyncAction, saveKnowledgeAction, searchKnowledgeAction, setPinnedAction,
} = actions;

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
afterEach(() => vi.useRealTimers());

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

const ORG = DEMO_CONTEXT.org.id;
const UUID = '3f2b0b9a-0000-4000-8000-000000000000';
const websites = async () => (await demoRepositories.knowledge.list()).filter((k) => k.kind === 'website');
const siteAt = async (url: string) => (await websites()).find((k) => k.url === url);
/** Ajoute un site par le formulaire et rend sa fiche ; le test la supprime à la fin (la démonstration plafonne à 5 sites). */
const addSite = async (url: string, extra: Record<string, string> = {}) => {
  const res = await addWebsiteAction({}, form({ url, ...extra }));
  return { res, site: await siteAt(new URL(url.includes('://') ? url : `https://${url}`).href) };
};
/** Laisse passer le temps de la lecture simulée (seule `Date` est simulée). */
const waitForReading = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 5_000);
};

describe('addWebsiteAction : ajouter un site', () => {
  it('enregistre le site (https ajouté, nom de domaine pour titre), le met en file de lecture et rafraîchit la page', async () => {
    const { res, site } = await addSite('Boutique-Test.fr/a-propos', { scope: 'page', autoSync: 'on' });
    expect(res.error).toBeUndefined();
    expect(res.savedAt).toEqual(expect.any(Number));
    expect(site).toMatchObject({ kind: 'website', title: 'boutique-test.fr', url: 'https://boutique-test.fr/a-propos', status: 'pending', scope: 'page', autoSync: true, pinned: false });
    expect(state.revalidated).toEqual(['/app/connaissances', '/app/calendrier']);
    await demoRepositories.knowledge.remove(site!.id);
  });

  it('une case décochée n’est pas envoyée par le navigateur : pas de relecture hebdomadaire ; tout le site est lu par défaut', async () => {
    const { site } = await addSite('https://sans-relecture.fr');
    expect(site).toMatchObject({ scope: 'site', autoSync: false });
    await demoRepositories.knowledge.remove(site!.id);
  });

  it('refuse une adresse qui n’est pas publique, sans rien enregistrer', async () => {
    const before = (await websites()).length;
    for (const url of ['', 'http://localhost:3000', '192.168.1.10', '10.0.0.1/admin', 'ftp://exemple.fr', 'https://utilisateur:mdp@exemple.fr', 'http://[::1]/', 'http://intranet.local', 'pas une adresse']) {
      const res = await addWebsiteAction({}, form({ url }));
      expect(res.error, url).toContain('app.knowledgePage.errors.invalidUrl');
      expect(res.savedAt).toBeUndefined();
    }
    expect(await websites()).toHaveLength(before);
    expect(state.revalidated).toEqual([]);
  });

  it('refuse un site déjà présent, et dit lequel des plafonds est atteint', async () => {
    const { site } = await addSite('doublon-action.fr');
    const again = await addWebsiteAction({}, form({ url: 'https://DOUBLON-action.fr/' }));
    expect(again.error).toContain('app.knowledgePage.errors.duplicate');
    expect(again.savedAt).toBeUndefined();
    await demoRepositories.knowledge.remove(site!.id);

    const added: string[] = [];
    while ((await websites()).length < KNOWLEDGE_LIMITS.sites) added.push((await addSite(`plafond-${added.length}.fr`)).site!.id);
    const full = await addWebsiteAction({}, form({ url: 'https://trop.fr' }));
    expect(full.error).toContain('app.knowledgePage.errors.sitesLimit');
    expect(full.error).toContain(`"max":${KNOWLEDGE_LIMITS.sites}`);
    await Promise.all(added.map((id) => demoRepositories.knowledge.remove(id)));
  });

  it('un lecteur n’ajoute rien ; un visiteur anonyme est renvoyé à la connexion', async () => {
    state.session = ready({ role: 'viewer' });
    expect(await addWebsiteAction({}, form({ url: 'https://lecteur.fr' }))).toEqual({ error: 'app.knowledge.viewerNote' });
    expect(await siteAt('https://lecteur.fr/')).toBeUndefined();
    state.session = { status: 'anonymous' } satisfies SessionState;
    await expect(addWebsiteAction({}, form({ url: 'https://anonyme.fr' }))).rejects.toThrow('redirect:/login');
  });
});

describe('registerDocumentAction : enregistrer un document déposé dans le stockage', () => {
  const path = `${ORG}/${UUID}-catalogue.pdf`;

  it('vérifie le fichier, l’enregistre sous un titre propre et rafraîchit la page', async () => {
    const addFile = vi.spyOn(demoRepositories.knowledge, 'addFile').mockResolvedValue({ ok: true, id: 'k-doc' });
    expect(await registerDocumentAction({ path, title: '  Catalogue   2026 ', size: 2048 })).toEqual({ ok: true });
    expect(addFile).toHaveBeenCalledExactlyOnceWith({ path, title: 'Catalogue 2026', size: 2048 });
    expect(state.revalidated).toEqual(['/app/connaissances', '/app/calendrier']);
    addFile.mockRestore();
  });

  it.each([
    ['un fichier d’une autre organisation', { path: `autre/${UUID}-doc.pdf`, title: 'Doc', size: 10 }, 'fileMissing'],
    ['un sous-dossier', { path: `${ORG}/sous/${UUID}-doc.pdf`, title: 'Doc', size: 10 }, 'fileMissing'],
    ['un type non pris en charge', { path: `${ORG}/${UUID}-doc.exe`, title: 'Doc', size: 10 }, 'unsupportedType'],
    ['un fichier vide', { path, title: 'Doc', size: 0 }, 'fileMissing'],
    ['un fichier de plus de 10 Mo', { path, title: 'Doc', size: KNOWLEDGE_LIMITS.fileBytes + 1 }, 'fileTooLarge'],
  ])('refuse %s sans interroger la base', async (_label, input, key) => {
    const addFile = vi.spyOn(demoRepositories.knowledge, 'addFile');
    const res = await registerDocumentAction(input);
    expect(res).toEqual({ ok: false, error: expect.stringContaining(`app.knowledgePage.errors.${key}`) });
    expect(addFile).not.toHaveBeenCalled();
    addFile.mockRestore();
  });

  it('rend le refus de la base (plafond atteint, doublon…) dans la langue de l’utilisateur, sans le texte de l’exception', async () => {
    const addFile = vi.spyOn(demoRepositories.knowledge, 'addFile').mockResolvedValueOnce({ ok: false, error: { key: 'app.knowledgePage.errors.filesLimit', params: { max: 40 } } });
    expect(await registerDocumentAction({ path, title: 'Doc', size: 10 })).toEqual({ ok: false, error: 'app.knowledgePage.errors.filesLimit {"max":40}' });
    addFile.mockResolvedValueOnce({ ok: false });
    expect(await registerDocumentAction({ path, title: 'Doc', size: 10 })).toEqual({ ok: false, error: 'app.knowledge.errSave' });
    expect(state.revalidated).toEqual([]);
    addFile.mockRestore();
  });

  it('en démonstration il n’y a pas de stockage : le fichier n’arrive pas par ici (voir /api/knowledge/demo-upload)', async () => {
    expect(await registerDocumentAction({ path, title: 'Doc', size: 10 })).toEqual({ ok: false, error: expect.stringContaining('app.knowledgePage.errors.fileMissing') });
  });

  it('un lecteur n’enregistre rien ; un visiteur anonyme est renvoyé à la connexion', async () => {
    const addFile = vi.spyOn(demoRepositories.knowledge, 'addFile');
    state.session = ready({ role: 'viewer' });
    expect(await registerDocumentAction({ path, title: 'Doc', size: 10 })).toEqual({ ok: false, error: 'app.knowledge.viewerNote' });
    state.session = { status: 'anonymous' } satisfies SessionState;
    await expect(registerDocumentAction({ path, title: 'Doc', size: 10 })).rejects.toThrow('redirect:/login');
    expect(addFile).not.toHaveBeenCalled();
    addFile.mockRestore();
  });
});

describe('requestSyncAction : « Actualiser » et « Réessayer »', () => {
  it('remet un site dans la file de lecture et rafraîchit la page', async () => {
    const { site } = await addSite('actualiser.exemple.fr');
    waitForReading();
    expect((await siteAt('https://actualiser.exemple.fr/'))!.status).toBe('ready');

    state.revalidated = [];
    expect(await requestSyncAction(site!.id)).toEqual({ ok: true });
    expect((await siteAt('https://actualiser.exemple.fr/'))!.status).toBe('pending');
    expect(state.revalidated).toEqual(['/app/connaissances', '/app/calendrier']);
    await demoRepositories.knowledge.remove(site!.id);
  });

  it('refuse une fiche de texte ou une source inconnue ; un lecteur ne relance rien', async () => {
    const text = (await demoRepositories.knowledge.create({ title: 'Texte simple', content: 'Du texte.' })).id!;
    expect(await requestSyncAction(text)).toEqual({ ok: false, error: 'app.knowledge.errSave' });
    expect(await requestSyncAction('fantome')).toEqual({ ok: false, error: 'app.knowledge.errSave' });
    expect(await requestSyncAction(undefined as unknown as string)).toEqual({ ok: false, error: 'app.knowledge.errSave' });

    const { site } = await addSite('lecteur-sync.exemple.fr');
    waitForReading();
    state.session = ready({ role: 'viewer' });
    expect(await requestSyncAction(site!.id)).toEqual({ ok: false, error: 'app.knowledge.viewerNote' });
    expect((await siteAt('https://lecteur-sync.exemple.fr/'))!.status).toBe('ready');
    await demoRepositories.knowledge.remove(site!.id);
  });
});

describe('listPagesAction : les pages lues d’un site', () => {
  it('rend les pages lues avec leur titre et le nombre de passages ; un lecteur peut les voir', async () => {
    const { site } = await addSite('pages-lues.exemple.fr');
    waitForReading();
    await demoRepositories.knowledge.list();
    state.session = ready({ role: 'viewer' });
    const pages = await listPagesAction(site!.id);
    expect(pages.map((p) => p.url)).toEqual([
      'https://pages-lues.exemple.fr/', 'https://pages-lues.exemple.fr/contact', 'https://pages-lues.exemple.fr/faq', 'https://pages-lues.exemple.fr/livraison',
    ]);
    expect(pages.every((p) => p.chunks > 0 && p.title.length > 0)).toBe(true);
    await demoRepositories.knowledge.remove(site!.id);
  });

  it('une source inconnue n’a pas de pages ; un visiteur anonyme n’en voit aucune (et n’est pas redirigé)', async () => {
    expect(await listPagesAction('fantome')).toEqual([]);
    expect(await listPagesAction(undefined as unknown as string)).toEqual([]);
    state.session = { status: 'anonymous' } satisfies SessionState;
    expect(await listPagesAction('fantome')).toEqual([]);
  });
});
