import { beforeAll, describe, expect, it } from 'vitest';
import { asService, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

type Row = { first_comment: string | null; first_comment_state: string | null; first_comment_id: string | null; first_comment_error: string | null };

/** Insère un post comme le ferait l'application (un client connecté). */
const insertAs = (user: string, extra = '', values: unknown[] = []) =>
  asUser(db, user, () =>
    q<{ id: string } & Row>(db,
      `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at, first_comment ${extra ? ', ' + extra.split('=')[0] : ''})
       values ($1, $2, $3, 'Bonjour', 'queued', now() + interval '1 day', 'Merci de votre soutien' ${extra ? ', $4' : ''}) returning id, first_comment, first_comment_state, first_comment_id, first_comment_error`,
      [w.orgA, w.intA, user, ...values]));

const get = async (id: string) => (await q<Row & { state: string; locked_until: string | null }>(db, 'select state, locked_until, first_comment, first_comment_state, first_comment_id, first_comment_error from public.posts where id = $1', [id]))[0]!;
/** Un post déjà publié avec un premier commentaire (créé par le service : la publication a eu lieu). */
const published = async (comment: string | null = 'Premier commentaire') =>
  (await q<{ id: string }>(db,
    `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at, release_id, first_comment)
     values ($1,$2,$3,'Bonjour','published', now() - interval '1 hour', 'REL_1', $4) returning id`, [w.orgA, w.intA, w.alice, comment]))[0]!.id;
const claim = () => asService(db, () => q<{ id: string; first_comment_state: string }>(db, 'select * from public.claim_first_comments(10, 60)'));

describe('premier commentaire : ce qu’un client peut écrire', () => {
  it('un commentaire à la création démarre « pending »', async () => {
    const [row] = await insertAs(w.alice);
    expect(row!.first_comment).toBe('Merci de votre soutien');
    expect(row!.first_comment_state).toBe('pending');
  });

  it('sans commentaire, aucun suivi', async () => {
    const [row] = await asUser(db, w.alice, () =>
      q<Row>(db, `insert into public.posts (org_id, integration_id, created_by, content, state) values ($1,$2,$3,'x','draft') returning first_comment, first_comment_state, first_comment_id, first_comment_error`, [w.orgA, w.intA, w.alice]));
    expect(row).toEqual({ first_comment: null, first_comment_state: null, first_comment_id: null, first_comment_error: null });
  });

  it('un client ne peut pas se donner un état « posted », un identifiant ni une erreur', async () => {
    const [row] = await asUser(db, w.alice, () =>
      q<Row>(db,
        `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at, first_comment, first_comment_state, first_comment_id, first_comment_error)
         values ($1,$2,$3,'x','queued', now() + interval '1 day','Salut','posted','FAUX_ID','faux') returning first_comment, first_comment_state, first_comment_id, first_comment_error`, [w.orgA, w.intA, w.alice]));
    expect(row).toEqual({ first_comment: 'Salut', first_comment_state: 'pending', first_comment_id: null, first_comment_error: null });
  });

  it('un client ne peut pas modifier l’état d’un commentaire existant', async () => {
    const [{ id }] = await insertAs(w.alice);
    await expect(asUser(db, w.alice, () => q(db, `update public.posts set first_comment_state = 'posted' where id = $1`, [id!]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.posts set first_comment_id = 'X' where id = $1`, [id!]))).rejects.toThrow(/permission denied/);
  });

  it('refuse un commentaire vide ou de plus de 8 000 caractères', async () => {
    const bad = (text: string) => asUser(db, w.alice, () => q(db, `insert into public.posts (org_id, integration_id, created_by, content, state, first_comment) values ($1,$2,$3,'x','draft',$4)`, [w.orgA, w.intA, w.alice, text]));
    await expect(bad('   ')).rejects.toThrow(/check constraint/);
    await expect(bad('x'.repeat(8_001))).rejects.toThrow(/check constraint/);
    await expect(bad('x'.repeat(8_000))).resolves.toBeDefined();
  });

  it('l’état et le texte restent cohérents : pas d’état sans texte, ni de texte sans état', async () => {
    const id = await published();
    await expect(q(db, `update public.posts set first_comment_state = null where id = $1`, [id])).rejects.toThrow(/posts_first_comment_coherent/);
  });

  it('quand le texte change, le suivi repart de zéro', async () => {
    const id = await published();
    await q(db, `update public.posts set first_comment_state = 'posted', first_comment_id = 'C1' where id = $1`, [id]);
    expect((await get(id)).first_comment_state).toBe('posted');
    await q(db, `update public.posts set first_comment = 'Nouveau texte' where id = $1`, [id]);
    expect(await get(id)).toMatchObject({ first_comment: 'Nouveau texte', first_comment_state: 'pending', first_comment_id: null });
    await q(db, `update public.posts set first_comment = null where id = $1`, [id]);
    expect(await get(id)).toMatchObject({ first_comment: null, first_comment_state: null });
  });
});

describe('premier commentaire : file de publication', () => {
  it('ne réclame que les posts publiés dont le commentaire attend, une seule fois', async () => {
    await q(db, `delete from public.posts`);
    const due = await published();
    await published(null); // pas de commentaire
    await q(db, `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at, first_comment) values ($1,$2,$3,'x','queued', now() + interval '1 day', 'pas encore')`, [w.orgA, w.intA, w.alice]);
    const first = await claim();
    expect(first.map((p) => p.id)).toEqual([due]);
    expect(first[0]!.first_comment_state).toBe('posting');
    expect(await claim()).toHaveLength(0);
    expect((await get(due)).locked_until).not.toBeNull();
  });

  it('n’est pas appelable par un client', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select * from public.claim_first_comments(1, 60)'))).rejects.toThrow(/permission denied/);
  });

  it('un commentaire dont le worker ne s’est pas terminé passe en « unknown » et n’est jamais rejoué', async () => {
    await q(db, `delete from public.posts`);
    const id = await published();
    await claim();
    const before = await asService(db, () => q<{ sweep_stale_work: Record<string, number> }>(db, 'select public.sweep_stale_work()'));
    expect(before[0]!.sweep_stale_work.comments_unknown).toBe(0); // verrou encore valable
    expect((await get(id)).first_comment_state).toBe('posting');

    await q(db, `update public.posts set locked_until = now() - interval '1 minute' where id = $1`, [id]);
    const after = await asService(db, () => q<{ sweep_stale_work: Record<string, number> }>(db, 'select public.sweep_stale_work()'));
    expect(after[0]!.sweep_stale_work).toMatchObject({ comments_unknown: 1, posts_unknown: 0 });
    const row = await get(id);
    expect(row.first_comment_state).toBe('unknown');
    expect(row.first_comment_error).toMatch(/inconnu/i);
    expect(row.state).toBe('published'); // la publication elle-même n'est pas touchée
    expect(await claim()).toHaveLength(0);
  });

  it('le balayage des publications et des messages fonctionne toujours', async () => {
    const res = await asService(db, () => q<{ sweep_stale_work: Record<string, number> }>(db, 'select public.sweep_stale_work()'));
    expect(Object.keys(res[0]!.sweep_stale_work).sort()).toEqual(['comments_unknown', 'messages_failed', 'posts_unknown']);
  });
});

describe('premier commentaire : réessayer', () => {
  const failed = async () => {
    const id = await published();
    await q(db, `update public.posts set first_comment_state = 'failed', first_comment_error = 'LinkedIn a refusé' where id = $1`, [id]);
    return id;
  };
  const retry = (user: string, id: string) => asUser(db, user, async () => (await q<{ retry_first_comment: boolean }>(db, 'select public.retry_first_comment($1)', [id]))[0]!.retry_first_comment);

  it('un membre remet en file un commentaire refusé', async () => {
    const id = await failed();
    expect(await retry(w.carol, id)).toBe(true);
    expect(await get(id)).toMatchObject({ first_comment_state: 'pending', first_comment_error: null });
  });

  it('un lecteur et l’autre organisation ne le peuvent pas', async () => {
    const id = await failed();
    expect(await retry(w.dave, id)).toBe(false);
    expect(await retry(w.bob, id)).toBe(false);
    expect((await get(id)).first_comment_state).toBe('failed');
  });

  it('ne rejoue jamais un commentaire dont l’issue est inconnue, ni un commentaire déjà publié', async () => {
    const unknown = await published();
    await q(db, `update public.posts set first_comment_state = 'unknown' where id = $1`, [unknown]);
    const posted = await published();
    await q(db, `update public.posts set first_comment_state = 'posted', first_comment_id = 'C' where id = $1`, [posted]);
    expect(await retry(w.alice, unknown)).toBe(false);
    expect(await retry(w.alice, posted)).toBe(false);
    expect((await get(unknown)).first_comment_state).toBe('unknown');
    expect((await get(posted)).first_comment_state).toBe('posted');
  });

  it('un visiteur anonyme ne peut pas l’appeler', async () => {
    const { asAnon } = await import('./harness');
    await expect(asAnon(db, () => q(db, 'select public.retry_first_comment($1)', ['00000000-0000-0000-0000-000000000000']))).rejects.toThrow(/permission denied/);
  });
});
