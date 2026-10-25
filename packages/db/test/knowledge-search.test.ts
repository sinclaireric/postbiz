import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const item = (user: string, org: string, title: string, content = 'Contenu de la fiche', pinned = true) =>
  asUser(db, user, () =>
    q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by, pinned) values ($1,$2,$3,$4,$5) returning id`, [org, title, content, user, pinned]).then((r) => r[0]!.id),
  );

type Chunk = { content: string; embedding?: number[] | null; meta?: Record<string, unknown> };
const replace = (user: string, itemId: string, chunks: Chunk[] | unknown) => asUser(db, user, () => q<{ n: number }>(db, `select public.knowledge_replace_chunks($1, $2::jsonb) as n`, [itemId, JSON.stringify(chunks)]).then((r) => r[0]!.n));
const row = (itemId: string) => q<{ chunk_count: number; indexed_at: string | null; embedded_at: string | null; pinned: boolean }>(db, 'select chunk_count, indexed_at, embedded_at, pinned from public.knowledge_items where id = $1', [itemId]).then((r) => r[0]!);
const chunksOf = (itemId: string) => q<{ ord: number; content: string; org_id: string; embedding: number[] | null }>(db, 'select ord, content, org_id, embedding from public.knowledge_chunks where item_id = $1 order by ord', [itemId]);

const search = (user: string, org: string, embedding: number[] | null, terms: string[], limit = 6, perItem = 3, exclude: string[] = []) =>
  asUser(db, user, () =>
    q<{ chunk_id: string; item_id: string; title: string; content: string; similarity: number; term_hits: number; score: number }>(db,
      `select * from public.knowledge_search($1, $2::real[], $3::text[], $4, $5, $6::uuid[])`, [org, embedding, terms, limit, perItem, exclude]));

describe('passages : écriture contrôlée', () => {
  it('remplace les passages d’une fiche et met à jour son état d’indexation', async () => {
    const id = await item(w.alice, w.orgA, 'Tarifs');
    const n = await replace(w.alice, id, [{ content: 'Livraison offerte dès 60 euros.', embedding: [1, 0, 0] }, { content: 'Reprise de l’ancien meuble.', embedding: [0, 1, 0], meta: { heading: 'Reprise' } }]);
    expect(n).toBe(2);
    const state = await row(id);
    expect(state.chunk_count).toBe(2);
    expect(state.indexed_at).not.toBeNull();
    expect(state.embedded_at).not.toBeNull();
    expect((await chunksOf(id)).map((c) => [c.ord, c.content, c.org_id])).toEqual([[0, 'Livraison offerte dès 60 euros.', w.orgA], [1, 'Reprise de l’ancien meuble.', w.orgA]]);

    // Un second appel remplace tout : pas de doublon, l'ordre repart de zéro.
    expect(await replace(w.alice, id, [{ content: 'Un seul passage', embedding: [0, 0, 1] }])).toBe(1);
    expect((await chunksOf(id)).map((c) => [c.ord, c.content])).toEqual([[0, 'Un seul passage']]);
  });

  it('sans vecteur pour tous les passages, la fiche reste cherchable par ses mots mais n’est pas « vectorisée »', async () => {
    const id = await item(w.alice, w.orgA, 'Horaires');
    await replace(w.alice, id, [{ content: 'Atelier ouvert le samedi.', embedding: [1, 0, 0] }, { content: 'Fermé le dimanche.' }, { content: 'Vacances en août.', embedding: null }]);
    const state = await row(id);
    expect(state.chunk_count).toBe(3);
    expect(state.indexed_at).not.toBeNull();
    expect(state.embedded_at).toBeNull();
  });

  it('une fiche sans passage (texte vide de sens) est indexée avec zéro passage, jamais « vectorisée »', async () => {
    const id = await item(w.alice, w.orgA, 'Vide');
    expect(await replace(w.alice, id, [])).toBe(0);
    const state = await row(id);
    expect(state.chunk_count).toBe(0);
    expect(state.indexed_at).not.toBeNull();
    expect(state.embedded_at).toBeNull();
  });

  it('un membre indexe ; un lecteur, une autre organisation et un visiteur non', async () => {
    const id = await item(w.carol, w.orgA, 'Fiche de Carol');
    expect(await replace(w.carol, id, [{ content: 'ok' }])).toBe(1);
    await expect(replace(w.dave, id, [{ content: 'non' }])).rejects.toThrow(/knowledge_forbidden/);
    await expect(replace(w.bob, id, [{ content: 'non' }])).rejects.toThrow(/knowledge_forbidden/);
    await expect(asAnon(db, () => q(db, `select public.knowledge_replace_chunks($1, '[]'::jsonb)`, [id]))).rejects.toThrow(/permission denied/);
    // Une fiche qui n'existe pas n'est pas une fiche d'une organisation : même refus.
    await expect(replace(w.alice, '00000000-0000-0000-0000-000000000000', [{ content: 'x' }])).rejects.toThrow(/knowledge_forbidden/);
    expect((await chunksOf(id)).map((c) => c.content)).toEqual(['ok']);
  });

  it('aucun client n’écrit directement dans les passages', async () => {
    const id = await item(w.alice, w.orgA, 'Fiche protégée');
    await replace(w.alice, id, [{ content: 'passage' }]);
    await expect(asUser(db, w.alice, () => q(db, `insert into public.knowledge_chunks (org_id, item_id, ord, content) values ($1,$2,5,'pirate')`, [w.orgA, id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.knowledge_chunks set content = 'pirate' where item_id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `delete from public.knowledge_chunks where item_id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => q(db, 'select * from public.knowledge_chunks'))).rejects.toThrow(/permission denied/);
  });

  it('refuse un tableau mal formé, un passage vide ou démesuré', async () => {
    const id = await item(w.alice, w.orgA, 'Fiche stricte');
    await expect(replace(w.alice, id, { content: 'pas un tableau' })).rejects.toThrow(/doit être un tableau/);
    await expect(replace(w.alice, id, [{ content: '' }])).rejects.toThrow(/check/);
    await expect(replace(w.alice, id, [{ content: 'x'.repeat(6_001) }])).rejects.toThrow(/check/);
    await expect(replace(w.alice, id, [{ meta: {} }])).rejects.toThrow(/null value|not-null/);
  });

  it('plafonne à 40 passages par fiche et à 3 000 par organisation', async () => {
    const id = await item(w.alice, w.orgA, 'Fiche énorme');
    await expect(replace(w.alice, id, Array.from({ length: 41 }, (_, i) => ({ content: `p${i}` })))).rejects.toThrow(/knowledge_item_chunks_limit/);
    expect(await replace(w.alice, id, Array.from({ length: 40 }, (_, i) => ({ content: `p${i}` })))).toBe(40);

    // L'organisation B, vierge : 2 990 passages écrits directement (par le serveur), puis 11 de plus par une fiche.
    const big = await item(w.bob, w.orgB, 'Gros corpus');
    await q(db, `insert into public.knowledge_chunks (org_id, item_id, ord, content) select $1, $2, g, 'passage ' || g from generate_series(0, 2989) g`, [w.orgB, big]);
    const other = await item(w.bob, w.orgB, 'Une autre fiche');
    await expect(replace(w.bob, other, Array.from({ length: 11 }, (_, i) => ({ content: `n${i}` })))).rejects.toThrow(/knowledge_chunks_limit/);
    expect(await replace(w.bob, other, Array.from({ length: 10 }, (_, i) => ({ content: `n${i}` })))).toBe(10);
    // Réindexer la grosse fiche elle-même n'est pas bloqué par ses propres anciens passages.
    expect(await replace(w.bob, big, Array.from({ length: 40 }, (_, i) => ({ content: `r${i}` })))).toBe(40);
  });
});

describe('passages : cohérence avec la fiche', () => {
  it('modifier le titre ou le contenu supprime les passages ; épingler ou désépingler les garde', async () => {
    const id = await item(w.alice, w.orgA, 'Fiche changeante');
    await replace(w.alice, id, [{ content: 'a', embedding: [1, 0, 0] }]);

    await asUser(db, w.alice, () => q(db, `update public.knowledge_items set pinned = false where id = $1`, [id]));
    expect((await row(id))).toMatchObject({ pinned: false, chunk_count: 1 });
    expect(await chunksOf(id)).toHaveLength(1);

    await asUser(db, w.alice, () => q(db, `update public.knowledge_items set content = 'Nouveau contenu' where id = $1`, [id]));
    expect(await row(id)).toMatchObject({ chunk_count: 0, indexed_at: null, embedded_at: null });
    expect(await chunksOf(id)).toHaveLength(0);

    await replace(w.alice, id, [{ content: 'b' }]);
    await asUser(db, w.alice, () => q(db, `update public.knowledge_items set title = 'Nouveau titre' where id = $1`, [id]));
    expect(await row(id)).toMatchObject({ chunk_count: 0, indexed_at: null });
  });

  it('un membre ne touche ni à l’état d’indexation ni à l’organisation d’une fiche', async () => {
    const id = await item(w.alice, w.orgA, 'Fiche gardée');
    await expect(asUser(db, w.alice, () => q(db, `update public.knowledge_items set chunk_count = 99 where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.knowledge_items set indexed_at = now() where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.knowledge_items set embedded_at = now() where id = $1`, [id]))).rejects.toThrow(/permission denied/);
  });

  it('supprimer la fiche supprime ses passages', async () => {
    const id = await item(w.alice, w.orgA, 'Fiche éphémère');
    await replace(w.alice, id, [{ content: 'a' }, { content: 'b' }]);
    await asUser(db, w.alice, () => q(db, 'delete from public.knowledge_items where id = $1', [id]));
    expect(await chunksOf(id)).toHaveLength(0);
  });

  it('les passages se lisent dans son organisation (lecteur compris), jamais dans une autre', async () => {
    const id = await item(w.alice, w.orgA, 'Fiche visible');
    await replace(w.alice, id, [{ content: 'secret de l’organisation A' }]);
    const read = (user: string) => asUser(db, user, () => q<{ content: string }>(db, `select content from public.knowledge_chunks where item_id = $1`, [id]));
    expect((await read(w.carol)).map((c) => c.content)).toEqual(['secret de l’organisation A']);
    expect((await read(w.dave)).map((c) => c.content)).toEqual(['secret de l’organisation A']);
    expect(await read(w.bob)).toEqual([]);
  });
});

describe('recherche', () => {
  let tarifs: string;
  let faq: string;
  let long: string;

  beforeAll(async () => {
    // Une organisation vierge pour ne pas mêler les passages des tests précédents : l'organisation C.
    const erin = (await q<{ id: string }>(db, `insert into auth.users (email) values ('erin@c.test') returning id`))[0]!.id;
    const orgC = await asUser(db, erin, async () => (await q<{ id: string }>(db, `select public.create_organization('Org C') as id`))[0]!.id);
    (w as World & { orgC: string; erin: string }).orgC = orgC;
    (w as World & { orgC: string; erin: string }).erin = erin;
    tarifs = await item(erin, orgC, 'Tarifs', 'x', false);
    faq = await item(erin, orgC, 'Questions fréquentes', 'x', false);
    long = await item(erin, orgC, 'Catalogue', 'x', false);
    await replace(erin, tarifs, [
      { content: 'Livraison offerte dès 60 euros en France métropolitaine.', embedding: [1, 0, 0] },
      { content: 'Reprise gratuite de l’ancien meuble pour tout achat d’une table.', embedding: [0.9, 0.1, 0] },
    ]);
    await replace(erin, faq, [
      { content: 'Délai de fabrication de trois à quatre semaines.', embedding: [0, 1, 0] },
      { content: 'Atelier ouvert au public le samedi de dix heures à dix-sept heures.' },
    ]);
    await replace(erin, long, Array.from({ length: 5 }, (_, i) => ({ content: `Modèle ${i} en chêne massif, huile naturelle.`, embedding: [0, 0, 1] })));
  });

  const orgC = () => (w as World & { orgC: string }).orgC;
  const erin = () => (w as World & { erin: string }).erin;

  it('par les mots seulement : le passage qui contient le plus de mots de la question vient en premier', async () => {
    const hits = await search(erin(), orgC(), null, ['livraison', 'offerte', 'france']);
    expect(hits[0]!.content).toContain('Livraison offerte');
    expect(hits[0]!.term_hits).toBe(3);
    expect(hits[0]!.title).toBe('Tarifs');
    expect(hits.every((h) => h.similarity === 0)).toBe(true);
  });

  it('par le sens : le passage le plus proche du vecteur de la question vient en premier, avec sa similarité', async () => {
    const hits = await search(erin(), orgC(), [1, 0, 0], []);
    expect(hits[0]!.content).toContain('Livraison offerte');
    expect(hits[0]!.similarity).toBeCloseTo(1, 5);
    expect(hits[1]!.content).toContain('Reprise gratuite');
    expect(hits[1]!.similarity).toBeGreaterThan(0.9);
    expect(hits[1]!.similarity).toBeLessThan(1);
  });

  it('hybride : un passage trouvé par le sens et par les mots passe devant ; un passage sans vecteur reste trouvable par ses mots', async () => {
    const hits = await search(erin(), orgC(), [0, 1, 0], ['atelier', 'samedi']);
    const order = hits.map((h) => h.content);
    // « Délai de fabrication » est le plus proche par le sens ; « Atelier ouvert… » n'a pas de vecteur mais contient les deux mots.
    expect(order).toContain('Atelier ouvert au public le samedi de dix heures à dix-sept heures.');
    expect(order.some((c) => c.startsWith('Délai de fabrication'))).toBe(true);
    const atelier = hits.find((h) => h.content.startsWith('Atelier ouvert'))!;
    expect(atelier.term_hits).toBe(2);
    expect(atelier.similarity).toBe(0);
  });

  it('au plus p_per_item passages par fiche, et p_limit en tout', async () => {
    const hits = await search(erin(), orgC(), [0, 0, 1], ['chêne', 'massif'], 20, 2);
    expect(hits.filter((h) => h.title === 'Catalogue')).toHaveLength(2);
    expect((await search(erin(), orgC(), [0, 0, 1], ['chêne'], 3, 5)).length).toBeLessThanOrEqual(3);
    // Plafonds de sécurité : au moins 1, au plus 20.
    expect((await search(erin(), orgC(), [0, 0, 1], ['chêne'], 0, 5))).toHaveLength(1);
    expect((await search(erin(), orgC(), [0, 0, 1], ['chêne'], 1000, 5)).length).toBeLessThanOrEqual(20);
  });

  it('écarte les fiches déjà envoyées en entier à l’IA', async () => {
    const hits = await search(erin(), orgC(), [1, 0, 0], ['livraison'], 6, 3, [tarifs]);
    expect(hits.some((h) => h.item_id === tarifs)).toBe(false);
  });

  it('sans mots ni vecteur, rien', async () => {
    expect(await search(erin(), orgC(), null, [])).toEqual([]);
    expect(await search(erin(), orgC(), null, ['inexistantxyz'])).toEqual([]);
  });

  it('chaque organisation ne cherche que dans ses passages', async () => {
    expect(await search(w.alice, orgC(), [1, 0, 0], ['livraison'])).toEqual([]);
    expect(await search(w.bob, orgC(), [1, 0, 0], ['livraison'])).toEqual([]);
    // Une organisation voisine, avec ses propres passages, ne voit pas ceux d'Erin.
    const mine = await item(w.alice, w.orgA, 'Livraison A');
    await replace(w.alice, mine, [{ content: 'Livraison offerte chez Maison A.', embedding: [1, 0, 0] }]);
    const own = await search(w.alice, w.orgA, [1, 0, 0], ['livraison']);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((h) => h.item_id !== tarifs)).toBe(true);
    // Un lecteur peut chercher dans son organisation (la recherche est une lecture).
    expect((await search(w.dave, w.orgA, [1, 0, 0], ['livraison'])).length).toBeGreaterThan(0);
  });

  it('un visiteur anonyme ne cherche pas', async () => {
    await expect(asAnon(db, () => q(db, `select * from public.knowledge_search($1, null, '{}'::text[])`, [orgC()]))).rejects.toThrow(/permission denied/);
  });
});

describe('suggestions de réponse (inbox)', () => {
  let conversation: string;
  let foreign: string;

  const conversationOf = async (org: string, integration: string, ext: string) => {
    const contact = (await q<{ id: string }>(db, `insert into public.contacts (org_id, integration_id, platform_user_id, name) values ($1,$2,$3,'Camille') returning id`, [org, integration, `u-${ext}`]))[0]!.id;
    return (await q<{ id: string }>(db, `insert into public.conversations (org_id, integration_id, contact_id, kind, external_id) values ($1,$2,$3,'dm',$4) returning id`, [org, integration, contact, ext]))[0]!.id;
  };
  const suggest = (user: string, org: string, conv: string, as: string = user) =>
    asUser(db, user, () => q<{ id: string }>(db,
      `insert into public.ai_reply_suggestions (org_id, conversation_id, user_id, reply, grounded, sources, model) values ($1,$2,$3,'Bonjour !',true,'[{"title":"Tarifs"}]'::jsonb,'gpt-4.1') returning id`, [org, conv, as]).then((r) => r[0]!.id));

  beforeAll(async () => {
    conversation = await conversationOf(w.orgA, w.intA, 'dm-a');
    foreign = await conversationOf(w.orgB, w.intB, 'dm-b');
  });

  it('un membre enregistre sa suggestion pour une conversation de son organisation', async () => {
    const id = await suggest(w.carol, w.orgA, conversation);
    const rows = await asUser(db, w.alice, () => q<{ id: string; outcome: string | null }>(db, 'select id, outcome from public.ai_reply_suggestions where id = $1', [id]));
    // Les membres de l'organisation les lisent toutes (elles servent aussi à compter le plafond du jour).
    expect(rows).toEqual([{ id, outcome: null }]);
    expect(await asUser(db, w.bob, () => q(db, 'select id from public.ai_reply_suggestions where id = $1', [id]))).toEqual([]);
  });

  it('pas au nom d’un autre, pas pour une conversation d’une autre organisation, pas comme lecteur ou visiteur', async () => {
    await expect(suggest(w.alice, w.orgA, conversation, w.carol)).rejects.toThrow(/row-level security/);
    await expect(suggest(w.alice, w.orgA, foreign)).rejects.toThrow(/row-level security/);
    await expect(suggest(w.bob, w.orgA, conversation)).rejects.toThrow(/row-level security/);
    await expect(suggest(w.dave, w.orgA, conversation)).rejects.toThrow(/row-level security/);
    await expect(asAnon(db, () => q(db, 'select * from public.ai_reply_suggestions'))).rejects.toThrow(/permission denied/);
  });

  it('son auteur marque ce qu’il en a fait ; rien d’autre ne change, et personne d’autre ne le marque', async () => {
    const id = await suggest(w.carol, w.orgA, conversation);
    await asUser(db, w.carol, () => q(db, `update public.ai_reply_suggestions set outcome = 'edited' where id = $1`, [id]));
    expect((await q<{ outcome: string }>(db, 'select outcome from public.ai_reply_suggestions where id = $1', [id]))[0]!.outcome).toBe('edited');
    await expect(asUser(db, w.carol, () => q(db, `update public.ai_reply_suggestions set outcome = 'ignored' where id = $1`, [id]))).rejects.toThrow(/check/);
    await expect(asUser(db, w.carol, () => q(db, `update public.ai_reply_suggestions set reply = 'autre' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.carol, () => q(db, `delete from public.ai_reply_suggestions where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    expect(await asUser(db, w.alice, () => q(db, `update public.ai_reply_suggestions set outcome = 'sent' where id = $1 returning id`, [id]))).toHaveLength(0);
  });

  it('elles disparaissent avec la conversation', async () => {
    const conv = await conversationOf(w.orgA, w.intA, 'dm-a-2');
    const id = await suggest(w.alice, w.orgA, conv);
    await q(db, 'delete from public.conversations where id = $1', [conv]);
    expect(await q(db, 'select id from public.ai_reply_suggestions where id = $1', [id])).toEqual([]);
  });
});
