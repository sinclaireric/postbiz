import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoRepositories } from './demo';
import { KNOWLEDGE_LIMITS } from './types';

const kb = demoRepositories.knowledge;
const bytes = (text: string) => new TextEncoder().encode(text);
const find = async (id: string) => (await kb.list()).find((k) => k.id === id)!;
const hitsOf = async (id: string, terms: string[]) => (await kb.search({ embedding: null, terms, limit: 6, perItem: 3, exclude: [] })).filter((h) => h.itemId === id);
const addText = (name: string, text: string, title = '') => kb.addFile({ path: `org/${name}`, title, size: 0, bytes: bytes(text) });

// Le site d'exemple est lu par le vrai code ; seul le temps est simulé : « en attente » 1,5 s, « en cours » jusqu'à 4 s, puis la lecture.
const clock = {
  start: () => vi.useFakeTimers({ toFake: ['Date'] }),
  tick: (ms: number) => vi.setSystemTime(Date.now() + ms),
  /** Laisse passer assez de temps pour que la lecture simulée ait lieu. */
  settle: () => vi.setSystemTime(Date.now() + 5_000),
};
afterEach(() => vi.useRealTimers());

describe('documents en mode démo : lus tout de suite, pour de vrai', () => {
  it('un fichier de texte est prêt aussitôt, avec son aperçu, ses passages et la recherche par les mots', async () => {
    const res = await addText('conditions-livraison.txt', 'Livraison offerte dès 60 euros en France métropolitaine.\n\nLes retours sont acceptés pendant quatorze jours.', 'Conditions de livraison');
    expect(res.ok).toBe(true);
    const item = await find(res.id!);
    expect(item).toMatchObject({
      kind: 'file', status: 'ready', title: 'Conditions de livraison', fileName: 'conditions-livraison.txt', pinned: false, error: null, scope: null, url: null,
      chunkCount: 1, embeddedAt: null,
    });
    expect(item.sizeBytes).toBe(bytes('Livraison offerte dès 60 euros en France métropolitaine.\n\nLes retours sont acceptés pendant quatorze jours.').length);
    expect(item.content).toContain('Livraison offerte');
    expect(item.indexedAt).not.toBeNull();
    expect(item.syncedAt).not.toBeNull();
    expect(item.stats).toMatchObject({ chunks: 1, embedded: false });

    const hits = await hitsOf(item.id, ['retours', 'quatorze']);
    expect(hits[0]).toMatchObject({ itemId: item.id, title: 'Conditions de livraison', termHits: 2 });
  });

  it('le titre vient du nom du fichier quand il n’est pas donné', async () => {
    const res = await addText('liste_des_prix_2026.txt', 'Table en chêne : 890 euros.');
    expect((await find(res.id!)).title).toBe('liste des prix 2026');
  });

  it('un tableau CSV, une page HTML et un fichier Markdown sont lus selon leur format', async () => {
    const csv = await addText('tarifs.csv', 'produit;prix\nTable chêne;890\nChaise noyer;240\n');
    const html = await addText('apropos.html', '<html><head><title>À propos</title></head><body><main><h1>Notre atelier</h1><p>Fabrication artisanale à Lyon depuis 2012.</p></main></body></html>');
    const md = await addText('charte.md', '# Charte\n\nNous tutoyons nos clients et restons chaleureux.\n');
    for (const res of [csv, html, md]) expect((await find(res.id!)).status).toBe('ready');
    expect((await hitsOf(csv.id!, ['chaise', 'noyer']))[0]!.content).toContain('Chaise noyer');
    expect((await hitsOf(html.id!, ['artisanale', 'lyon']))[0]!.content).toContain('Fabrication artisanale');
    expect((await hitsOf(md.id!, ['tutoyons', 'clients']))[0]!.content).toContain('tutoyons');
  });

  it('un fichier illisible devient une source en échec avec son code, jamais le texte d’une exception', async () => {
    const fake = await kb.addFile({ path: 'org/faux.pdf', title: 'Faux PDF', size: 0, bytes: bytes('ceci n’est pas un PDF') });
    expect(fake.ok).toBe(true);
    expect(await find(fake.id!)).toMatchObject({ status: 'failed', error: 'corrupt', chunkCount: 0 });

    const empty = await addText('blanc.txt', '   \n\n   ');
    expect(await find(empty.id!)).toMatchObject({ status: 'failed', error: 'no_text' });
  });

  it('« Réessayer » relit le fichier : même résultat si rien n’a changé', async () => {
    const res = await kb.addFile({ path: 'org/encore-faux.pdf', title: 'Encore faux', size: 0, bytes: bytes('pas un pdf') });
    expect((await kb.requestSync(res.id!)).ok).toBe(true);
    expect(await find(res.id!)).toMatchObject({ status: 'failed', error: 'corrupt' });

    const good = await addText('relu.txt', 'Texte stable sur le hêtre.');
    const before = await find(good.id!);
    expect((await kb.requestSync(good.id!)).ok).toBe(true);
    const after = await find(good.id!);
    expect(after).toMatchObject({ status: 'ready', chunkCount: before.chunkCount, error: null });
    expect((await hitsOf(good.id!, ['hêtre'])).length).toBe(1);
  });

  it('refuse un type non pris en charge, un fichier vide ou trop gros, en disant pourquoi', async () => {
    expect(await addText('programme.exe', 'MZ')).toMatchObject({ ok: false, error: { key: 'app.knowledgePage.errors.unsupportedType' } });
    expect(await kb.addFile({ path: 'org/vide.txt', title: '', size: 0, bytes: new Uint8Array(0) })).toMatchObject({ ok: false, error: { key: 'app.knowledgePage.errors.fileMissing' } });
    expect(await kb.addFile({ path: 'org/sans-octets.txt', title: '', size: 12 })).toMatchObject({ ok: false, error: { key: 'app.knowledgePage.errors.fileMissing' } });
    expect(await kb.addFile({ path: 'org/gros.txt', title: '', size: KNOWLEDGE_LIMITS.fileBytes + 1, bytes: bytes('x') })).toMatchObject({
      ok: false, error: { key: 'app.knowledgePage.errors.fileTooLarge', params: { max: 10 } },
    });
  });

  it('supprimer un document supprime ses passages ; l’épingler est refusé ; modifier son titre garde son contenu', async () => {
    const res = await addText('a-supprimer.txt', 'Le mélèze est un bois léger et résistant.', 'Bois');
    const id = res.id!;
    expect((await kb.setPinned(id, true)).ok).toBe(false);
    expect((await kb.setPinned(id, false)).ok).toBe(true);
    expect((await kb.update(id, { title: 'Bois légers', content: '' })).ok).toBe(true);
    expect(await find(id)).toMatchObject({ title: 'Bois légers', chunkCount: 1, status: 'ready' });
    expect((await find(id)).content).toContain('mélèze');
    expect(await hitsOf(id, ['mélèze'])).toHaveLength(1);

    await kb.remove(id);
    expect(await hitsOf(id, ['mélèze'])).toEqual([]);
    expect((await kb.list()).some((k) => k.id === id)).toBe(false);
    // Le fichier gardé pour « Réessayer » est parti avec lui.
    expect((await kb.requestSync(id)).ok).toBe(false);
  });
});

describe('sites en mode démo : un site d’exemple lu en quelques secondes', () => {
  it('est d’abord en attente, puis en cours, puis prêt : le site d’exemple est lu par le vrai code', async () => {
    clock.start();
    const res = await kb.addWebsite({ url: 'https://www.maison-lune.fr/', title: 'maison-lune.fr', scope: 'site', autoSync: true });
    expect(res.ok).toBe(true);
    const id = res.id!;

    expect(await find(id)).toMatchObject({ kind: 'website', status: 'pending', url: 'https://www.maison-lune.fr/', scope: 'site', autoSync: true, pinned: false, chunkCount: 0, error: null });
    clock.tick(1_000);
    expect((await find(id)).status).toBe('pending');
    clock.tick(1_000);
    expect((await find(id)).status).toBe('processing');
    clock.tick(3_000);

    const site = await find(id);
    expect(site).toMatchObject({ status: 'ready', error: null, scope: 'site', embeddedAt: null });
    expect(site.chunkCount).toBeGreaterThanOrEqual(4);
    expect(site.stats).toMatchObject({ total: 4, fetched: 4, embedded: false });
    expect(site.content).toContain('Maison Lune');
    expect(site.syncedAt).not.toBeNull();
    // Relu chaque semaine : prochaine lecture dans 7 jours.
    expect(new Date(site.runAt!).getTime() - Date.now()).toBe(7 * 24 * 3_600_000);

    expect((await kb.pages(id)).map((p) => p.url)).toEqual([
      'https://www.maison-lune.fr/', 'https://www.maison-lune.fr/contact', 'https://www.maison-lune.fr/faq', 'https://www.maison-lune.fr/livraison',
    ]);
    expect((await kb.pages(id)).every((p) => p.chunks > 0 && p.title.includes('Maison Lune'))).toBe(true);
    await kb.remove(id);
  });

  it('les passages d’un site portent l’adresse et le titre de leur page, que la recherche rend', async () => {
    clock.start();
    const id = (await kb.addWebsite({ url: 'https://atelier-nord.fr/', title: 'atelier-nord.fr', scope: 'site', autoSync: false })).id!;
    clock.settle();
    expect((await find(id)).status).toBe('ready');

    const hits = await hitsOf(id, ['livraison', 'retours', 'quatorze']);
    expect(hits[0]).toMatchObject({ itemId: id, url: 'https://atelier-nord.fr/livraison', title: 'atelier-nord.fr' });
    expect(hits[0]!.pageTitle).toContain('Livraison');
    expect(hits[0]!.content).toContain('quatorze jours');
    // Pas de relecture hebdomadaire demandée : pas de prochaine lecture.
    expect((await find(id)).runAt).toBeNull();
    await kb.remove(id);
  });

  it('« cette page seulement » ne lit que la page de départ', async () => {
    clock.start();
    const id = (await kb.addWebsite({ url: 'https://une-page.fr/livraison', title: 'une-page.fr', scope: 'page', autoSync: true })).id!;
    clock.settle();
    const site = await find(id);
    expect(site).toMatchObject({ status: 'ready', scope: 'page', stats: expect.objectContaining({ total: 1 }) });
    expect((await kb.pages(id)).map((p) => p.url)).toEqual(['https://une-page.fr/livraison']);
    await kb.remove(id);
  });

  it.each([
    ['bloque.exemple.fr', 'robots_disallowed'],
    ['vide.exemple.fr', 'empty_site'],
    ['panne.exemple.fr', 'http_error'],
  ])('« %s » donne une lecture en échec expliquée par le code %s', async (host, code) => {
    clock.start();
    const id = (await kb.addWebsite({ url: `https://${host}/`, title: host, scope: 'site', autoSync: true })).id!;
    clock.settle();
    const site = await find(id);
    expect(site).toMatchObject({ status: 'failed', error: code, chunkCount: 0, runAt: null });
    expect(await kb.pages(id)).toEqual([]);

    // « Réessayer » remet la lecture en file ; l’échec se répète (le site n’a pas changé).
    expect((await kb.requestSync(id)).ok).toBe(true);
    expect((await find(id)).status).toBe('pending');
    clock.settle();
    expect(await find(id)).toMatchObject({ status: 'failed', error: code });
    await kb.remove(id);
  });

  it('« Actualiser » remet un site prêt en file et le relit sans rien changer ; pendant la lecture, c’est sans effet', async () => {
    clock.start();
    const id = (await kb.addWebsite({ url: 'https://relu.exemple.fr/', title: 'relu.exemple.fr', scope: 'site', autoSync: true })).id!;
    clock.settle();
    const first = await find(id);
    expect(first.status).toBe('ready');

    expect((await kb.requestSync(id)).ok).toBe(true);
    expect(await find(id)).toMatchObject({ status: 'pending', chunkCount: first.chunkCount });
    // Une deuxième demande pendant la lecture ne relance rien et ne casse rien.
    expect((await kb.requestSync(id)).ok).toBe(true);
    clock.tick(2_000);
    expect((await find(id)).status).toBe('processing');
    clock.tick(3_000);
    const second = await find(id);
    expect(second).toMatchObject({ status: 'ready', chunkCount: first.chunkCount });
    expect((await kb.pages(id)).length).toBe(4);
    await kb.remove(id);
  });

  it('refuse un site déjà présent, même écrit autrement (majuscules, barre finale)', async () => {
    const first = await kb.addWebsite({ url: 'https://doublon.exemple.fr/', title: 'doublon.exemple.fr', scope: 'site', autoSync: true });
    expect(first.ok).toBe(true);
    expect(await kb.addWebsite({ url: 'https://Doublon.exemple.fr', title: 'doublon.exemple.fr', scope: 'site', autoSync: true })).toMatchObject({
      ok: false, error: { key: 'app.knowledgePage.errors.duplicate' },
    });
    await kb.remove(first.id!);
    expect((await kb.addWebsite({ url: 'https://doublon.exemple.fr/', title: 'doublon.exemple.fr', scope: 'site', autoSync: true })).ok).toBe(true);
  });

  it('supprimer un site pendant sa lecture l’arrête : il ne revient pas', async () => {
    clock.start();
    const id = (await kb.addWebsite({ url: 'https://annule.exemple.fr/', title: 'annule.exemple.fr', scope: 'site', autoSync: true })).id!;
    await kb.remove(id);
    clock.settle();
    expect((await kb.list()).some((k) => k.id === id)).toBe(false);
    expect(await hitsOf(id, ['livraison'])).toEqual([]);
  });

  it('« Actualiser » n’a de sens que pour un document ou un site', async () => {
    const text = (await kb.create({ title: 'Fiche', content: 'Texte.' })).id!;
    expect((await kb.requestSync(text)).ok).toBe(false);
    expect((await kb.requestSync('fantome')).ok).toBe(false);
    expect(await kb.pages('fantome')).toEqual([]);
    expect(await kb.pages(text)).toEqual([]);
  });
});

describe('identifiants en mode démo', () => {
  it('deux copies du module (la route d’envoi et les actions du serveur en ont chacune une) ne donnent jamais le même identifiant, et partagent la même base', async () => {
    const first = await kb.create({ title: 'Première', content: 'Texte un.' });
    vi.resetModules();
    const other = (await import('./demo')).demoRepositories.knowledge;
    const second = await other.create({ title: 'Seconde', content: 'Texte deux.' });
    expect(second.id).not.toBe(first.id);
    expect((await kb.list()).some((k) => k.id === second.id)).toBe(true);
    expect((await other.list()).some((k) => k.id === first.id)).toBe(true);
    // « Actualiser » d'un site ne tombe donc pas sur un document qui porterait le même identifiant.
    const doc = await other.addFile({ path: 'org/memes-ids.txt', title: '', size: 0, bytes: bytes('Un document.') });
    const site = await kb.addWebsite({ url: 'https://ids.exemple.fr/', title: 'ids.exemple.fr', scope: 'page', autoSync: false });
    expect(doc.id).not.toBe(site.id);
    await kb.remove(site.id!);
    await kb.remove(doc.id!);
  });
});

describe('plafonds en mode démo', () => {
  it('40 documents, 5 sites, 100 sources en tout', async () => {
    const files = (await kb.list()).filter((k) => k.kind === 'file').length;
    for (let i = files; i < KNOWLEDGE_LIMITS.files; i++) expect((await addText(`plafond-${i}.txt`, `Texte numéro ${i}.`)).ok).toBe(true);
    expect(await addText('trop.txt', 'Un de plus.')).toMatchObject({ ok: false, error: { key: 'app.knowledgePage.errors.filesLimit', params: { max: KNOWLEDGE_LIMITS.files } } });

    const sites = (await kb.list()).filter((k) => k.kind === 'website').length;
    for (let i = sites; i < KNOWLEDGE_LIMITS.sites; i++) expect((await kb.addWebsite({ url: `https://site-${i}.exemple.fr/`, title: `site-${i}`, scope: 'page', autoSync: false })).ok).toBe(true);
    expect(await kb.addWebsite({ url: 'https://un-de-trop.exemple.fr/', title: 'un-de-trop', scope: 'page', autoSync: false })).toMatchObject({
      ok: false, error: { key: 'app.knowledgePage.errors.sitesLimit', params: { max: KNOWLEDGE_LIMITS.sites } },
    });

    // Les documents et les sites comptent dans les 100 sources, avec les fiches de texte.
    while ((await kb.list()).length < KNOWLEDGE_LIMITS.items) await kb.create({ title: 'Remplissage', content: 'Texte.' });
    expect(await addText('cent-unieme.txt', 'Trop.')).toMatchObject({ ok: false, error: { key: 'app.knowledge.errLimit', params: { max: KNOWLEDGE_LIMITS.items } } });
    expect(await kb.addWebsite({ url: 'https://cent-unieme.exemple.fr/', title: 'x', scope: 'page', autoSync: false })).toMatchObject({ ok: false, error: { key: 'app.knowledge.errLimit' } });
  });
});
