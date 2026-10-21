import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const insert = (org: string, by: string, title = 'Ton de la marque', content = 'Nous tutoyons nos clients.') =>
  q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,$2,$3,$4) returning id`, [org, title, content, by]);

describe('base de connaissance : isolation et rôles', () => {
  it('chaque organisation ne voit que ses fiches', async () => {
    const a = (await asUser(db, w.alice, () => insert(w.orgA, w.alice, 'Fiche A')))[0]!.id;
    const b = (await asUser(db, w.bob, () => insert(w.orgB, w.bob, 'Fiche B')))[0]!.id;
    const seenByAlice = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.knowledge_items'));
    const seenByBob = await asUser(db, w.bob, () => q<{ id: string }>(db, 'select id from public.knowledge_items'));
    expect(seenByAlice.map((r) => r.id)).toEqual([a]);
    expect(seenByBob.map((r) => r.id)).toEqual([b]);
  });

  it('un lecteur lit les fiches mais ne peut ni en créer, ni modifier, ni supprimer', async () => {
    const seen = await asUser(db, w.dave, () => q(db, 'select id from public.knowledge_items'));
    expect(seen).toHaveLength(1);
    await expect(asUser(db, w.dave, () => insert(w.orgA, w.dave))).rejects.toThrow(/row-level security/);
    const id = (seen[0] as { id: string }).id;
    const updated = await asUser(db, w.dave, () => q(db, `update public.knowledge_items set title = 'X' where id = $1 returning id`, [id]));
    expect(updated).toHaveLength(0);
    const deleted = await asUser(db, w.dave, () => q(db, 'delete from public.knowledge_items where id = $1 returning id', [id]));
    expect(deleted).toHaveLength(0);
  });

  it('un membre crée, modifie et supprime ; le titre et le contenu seuls sont modifiables', async () => {
    const id = (await asUser(db, w.carol, () => insert(w.orgA, w.carol, 'Offres', 'Livraison offerte dès 60 €.')))[0]!.id;
    const changed = await asUser(db, w.carol, () => q<{ title: string }>(db, `update public.knowledge_items set title = 'Offres 2026' where id = $1 returning title`, [id]));
    expect(changed[0]!.title).toBe('Offres 2026');
    await expect(asUser(db, w.carol, () => q(db, `update public.knowledge_items set org_id = $2 where id = $1`, [id, w.orgB]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.carol, () => q(db, `update public.knowledge_items set created_by = $2 where id = $1`, [id, w.alice]))).rejects.toThrow(/permission denied/);
    const removed = await asUser(db, w.carol, () => q(db, 'delete from public.knowledge_items where id = $1 returning id', [id]));
    expect(removed).toHaveLength(1);
  });

  it('on ne peut pas écrire chez une autre organisation, ni sous le nom de quelqu’un d’autre', async () => {
    await expect(asUser(db, w.bob, () => insert(w.orgA, w.bob))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.alice, () => insert(w.orgA, w.carol))).rejects.toThrow(/row-level security/);
    const alien = (await asUser(db, w.bob, () => q<{ id: string }>(db, 'select id from public.knowledge_items')))[0]!.id;
    const touched = await asUser(db, w.alice, () => q(db, `update public.knowledge_items set title = 'Pirate' where id = $1 returning id`, [alien]));
    expect(touched).toHaveLength(0);
  });

  it('un visiteur anonyme ne lit rien', async () => {
    await expect(asAnon(db, () => q(db, 'select * from public.knowledge_items'))).rejects.toThrow(/permission denied/);
  });
});

describe('base de connaissance : limites', () => {
  it('refuse un titre ou un contenu vide ou démesuré', async () => {
    await expect(asUser(db, w.alice, () => insert(w.orgA, w.alice, '   '))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => insert(w.orgA, w.alice, 'x'.repeat(121)))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => insert(w.orgA, w.alice, 'Titre', ''))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => insert(w.orgA, w.alice, 'Titre', 'x'.repeat(20_001)))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => insert(w.orgA, w.alice, 'x'.repeat(120), 'x'.repeat(20_000)))).resolves.toHaveLength(1);
  });

  it('plafonne à 100 fiches par organisation, sans gêner les autres', async () => {
    const [{ n }] = await q<{ n: number }>(db, `select count(*)::int as n from public.knowledge_items where org_id = $1`, [w.orgA]);
    await q(db, `insert into public.knowledge_items (org_id, title, content, created_by)
                 select $1, 'Fiche ' || g, 'Contenu', $2 from generate_series(1, $3) g`, [w.orgA, w.alice, 100 - n]);
    await expect(asUser(db, w.alice, () => insert(w.orgA, w.alice))).rejects.toThrow(/knowledge_items_limit/);
    await expect(asUser(db, w.bob, () => insert(w.orgB, w.bob, 'Autre fiche'))).resolves.toHaveLength(1);
  });
});
