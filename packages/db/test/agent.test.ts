import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const thread = (org: string, by: string, title = 'Annonce de l’atelier') =>
  q<{ id: string }>(db, `insert into public.agent_threads (org_id, user_id, title) values ($1,$2,$3) returning id`, [org, by, title]);
const message = (threadId: string, org: string, role = 'user', content = 'Bonjour', proposals: unknown = []) =>
  q<{ id: string }>(db, `insert into public.agent_messages (thread_id, org_id, role, content, proposals) values ($1,$2,$3,$4,$5::jsonb) returning id`, [threadId, org, role, content, JSON.stringify(proposals)]);

describe('agent : conversations privées à leur auteur', () => {
  it('chaque utilisateur ne voit que ses conversations, même dans une organisation partagée', async () => {
    const a = (await asUser(db, w.alice, () => thread(w.orgA, w.alice, 'Fil d’Alice')))[0]!.id;
    const c = (await asUser(db, w.carol, () => thread(w.orgA, w.carol, 'Fil de Carol')))[0]!.id;
    const b = (await asUser(db, w.bob, () => thread(w.orgB, w.bob, 'Fil de Bob')))[0]!.id;
    const seen = (user: string) => asUser(db, user, () => q<{ id: string }>(db, 'select id from public.agent_threads order by title'));
    expect((await seen(w.alice)).map((r) => r.id)).toEqual([a]);
    expect((await seen(w.carol)).map((r) => r.id)).toEqual([c]);
    expect((await seen(w.bob)).map((r) => r.id)).toEqual([b]);
  });

  it('les messages suivent : on lit ceux de ses conversations, pas ceux d’un collègue', async () => {
    const [mine] = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.agent_threads'));
    await asUser(db, w.alice, () => message(mine!.id, w.orgA, 'user', 'Message d’Alice'));
    const [theirs] = await asUser(db, w.carol, () => q<{ id: string }>(db, 'select id from public.agent_threads'));
    await asUser(db, w.carol, () => message(theirs!.id, w.orgA, 'user', 'Message de Carol'));
    const read = (user: string) => asUser(db, user, () => q<{ content: string }>(db, 'select content from public.agent_messages'));
    expect((await read(w.alice)).map((r) => r.content)).toEqual(['Message d’Alice']);
    expect((await read(w.carol)).map((r) => r.content)).toEqual(['Message de Carol']);
    expect(await read(w.bob)).toEqual([]);
  });

  it('un lecteur n’a ni lecture ni écriture ; un visiteur anonyme ne lit rien', async () => {
    expect(await asUser(db, w.dave, () => q(db, 'select id from public.agent_threads'))).toEqual([]);
    await expect(asUser(db, w.dave, () => thread(w.orgA, w.dave))).rejects.toThrow(/row-level security/);
    await expect(asAnon(db, () => q(db, 'select * from public.agent_threads'))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => q(db, 'select * from public.agent_messages'))).rejects.toThrow(/permission denied/);
  });

  it('on ne crée pas de conversation chez une autre organisation, ni sous le nom d’un autre', async () => {
    await expect(asUser(db, w.bob, () => thread(w.orgA, w.bob))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.alice, () => thread(w.orgA, w.carol))).rejects.toThrow(/row-level security/);
  });
});

describe('agent : messages', () => {
  it('on n’écrit que dans ses propres conversations', async () => {
    const [mine] = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.agent_threads'));
    await expect(asUser(db, w.carol, () => message(mine!.id, w.orgA))).rejects.toThrow(/row-level security|foreign key/);
    await expect(asUser(db, w.bob, () => message(mine!.id, w.orgB))).rejects.toThrow(/row-level security|foreign key/);
  });

  it('même dans sa propre conversation, on ne peut pas écrire un message au nom d’une autre organisation', async () => {
    const [mine] = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.agent_threads'));
    await expect(asUser(db, w.alice, () => message(mine!.id, w.orgB))).rejects.toThrow(/row-level security|foreign key/);
  });

  it('un message ne peut pas être rattaché à une autre organisation que celle de sa conversation', async () => {
    const [mine] = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.agent_threads'));
    await expect(q(db, `insert into public.agent_messages (thread_id, org_id, role, content) values ($1,$2,'user','x')`, [mine!.id, w.orgB])).rejects.toThrow(/foreign key/);
  });

  it('refuse un rôle inconnu, un texte démesuré, des publications qui ne sont pas une liste', async () => {
    const [mine] = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.agent_threads'));
    await expect(asUser(db, w.alice, () => message(mine!.id, w.orgA, 'system'))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => message(mine!.id, w.orgA, 'user', 'x'.repeat(20_001)))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => message(mine!.id, w.orgA, 'assistant', 'ok', { not: 'a list' }))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => message(mine!.id, w.orgA, 'user', 'x'.repeat(20_000)))).resolves.toHaveLength(1);
  });

  it('le client ne change que l’état des publications d’un message, jamais son texte', async () => {
    const [mine] = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.agent_threads'));
    const id = (await asUser(db, w.alice, () => message(mine!.id, w.orgA, 'assistant', 'Voici', [{ id: 'p1', status: 'pending' }])))[0]!.id;
    const updated = await asUser(db, w.alice, () => q<{ proposals: { status: string }[] }>(db, `update public.agent_messages set proposals = $2::jsonb where id = $1 returning proposals`, [id, JSON.stringify([{ id: 'p1', status: 'draft' }])]));
    expect(updated[0]!.proposals[0]!.status).toBe('draft');
    await expect(asUser(db, w.alice, () => q(db, `update public.agent_messages set content = 'autre' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    // Un collègue qui connaît l'identifiant ne touche à rien : la ligne lui est invisible.
    const touched = await asUser(db, w.carol, () => q(db, `update public.agent_messages set proposals = '[]'::jsonb where id = $1 returning id`, [id]));
    expect(touched).toHaveLength(0);
  });

  it('remonte la conversation en tête de liste à chaque message', async () => {
    const id = (await asUser(db, w.alice, () => thread(w.orgA, w.alice, 'Plus récente')))[0]!.id;
    await q(db, `update public.agent_threads set updated_at = now() - interval '2 days' where id = $1`, [id]);
    await asUser(db, w.alice, () => message(id, w.orgA));
    const rows = await asUser(db, w.alice, () => q<{ title: string }>(db, 'select title from public.agent_threads order by updated_at desc limit 1'));
    expect(rows[0]!.title).toBe('Plus récente');
  });
});

describe('agent : titre, suppression, limites', () => {
  it('on renomme sa conversation, rien d’autre ; on la supprime avec ses messages', async () => {
    const id = (await asUser(db, w.carol, () => thread(w.orgA, w.carol, 'À supprimer')))[0]!.id;
    await asUser(db, w.carol, () => message(id, w.orgA));
    const renamed = await asUser(db, w.carol, () => q<{ title: string }>(db, `update public.agent_threads set title = 'Renommée' where id = $1 returning title`, [id]));
    expect(renamed[0]!.title).toBe('Renommée');
    await expect(asUser(db, w.carol, () => q(db, `update public.agent_threads set org_id = $2 where id = $1`, [id, w.orgB]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.carol, () => q(db, `update public.agent_threads set user_id = $2 where id = $1`, [id, w.alice]))).rejects.toThrow(/permission denied/);
    // Ni Alice (même organisation) ni Bob ne peuvent la supprimer.
    expect(await asUser(db, w.alice, () => q(db, 'delete from public.agent_threads where id = $1 returning id', [id]))).toHaveLength(0);
    expect(await asUser(db, w.bob, () => q(db, 'delete from public.agent_threads where id = $1 returning id', [id]))).toHaveLength(0);
    expect(await asUser(db, w.carol, () => q(db, 'delete from public.agent_threads where id = $1 returning id', [id]))).toHaveLength(1);
    const [row] = await q<{ n: number }>(db, `select count(*)::int as n from public.agent_messages where thread_id = $1`, [id]);
    expect(row!.n).toBe(0);
  });

  it('refuse un titre vide ou démesuré', async () => {
    await expect(asUser(db, w.alice, () => thread(w.orgA, w.alice, '   '))).rejects.toThrow(/check constraint/);
    await expect(asUser(db, w.alice, () => thread(w.orgA, w.alice, 'x'.repeat(121)))).rejects.toThrow(/check constraint/);
  });

  it('plafonne les messages d’une conversation', async () => {
    const id = (await asUser(db, w.alice, () => thread(w.orgA, w.alice, 'Très longue')))[0]!.id;
    await q(db, `insert into public.agent_messages (thread_id, org_id, role, content) select $1, $2, 'user', 'm' || g from generate_series(1, 400) g`, [id, w.orgA]);
    await expect(asUser(db, w.alice, () => message(id, w.orgA))).rejects.toThrow(/agent_messages_limit/);
  });

  it('plafonne les conversations par utilisateur, sans gêner les autres', async () => {
    const [row] = await q<{ n: number }>(db, `select count(*)::int as n from public.agent_threads where org_id = $1 and user_id = $2`, [w.orgA, w.alice]);
    await q(db, `insert into public.agent_threads (org_id, user_id, title) select $1, $2, 'Fil ' || g from generate_series(1, $3::int) g`, [w.orgA, w.alice, 200 - row!.n]);
    await expect(asUser(db, w.alice, () => thread(w.orgA, w.alice))).rejects.toThrow(/agent_threads_limit/);
    await expect(asUser(db, w.carol, () => thread(w.orgA, w.carol))).resolves.toHaveLength(1);
    await expect(asUser(db, w.bob, () => thread(w.orgB, w.bob))).resolves.toHaveLength(1);
  });
});
