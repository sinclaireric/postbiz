import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createDb, createUser, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;
let owner: string;

const admin = <T>(fn: () => Promise<T>) => asUser(db, owner, fn);
const suspend = (user: string, reason: string | null = null) => admin(() => q(db, 'select public.admin_suspend_user($1, $2)', [user, reason]));
const restore = (user: string) => admin(() => q(db, 'select public.admin_restore_user($1)', [user]));
const row = async (user: string) => (await q<any>(db, 'select * from public.user_suspensions where user_id = $1', [user]))[0];

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
  owner = await createUser(db, 'owner@postbiz.test');
  await asService(db, () => q(db, 'insert into public.platform_admins (user_id) values ($1)', [owner]));
});

describe('suspendre un utilisateur', () => {
  it('enregistre la suspension, bloque la connexion et ferme les sessions de ce compte seulement', async () => {
    await q(db, `insert into auth.sessions (user_id) values ($1), ($1), ($2)`, [w.dave, w.bob]);
    await suspend(w.dave, '  spam  ');
    expect(await row(w.dave)).toMatchObject({ user_id: w.dave, reason: 'spam', suspended_by: owner });
    const [u] = await q<{ years: number }>(db, `select round(extract(epoch from banned_until - now()) / 31557600)::int as years from auth.users where id = $1`, [w.dave]);
    expect(u!.years).toBe(100);
    expect(await q(db, 'select 1 from auth.sessions where user_id = $1', [w.dave])).toHaveLength(0);
    expect(await q(db, 'select 1 from auth.sessions where user_id = $1', [w.bob])).toHaveLength(1);
    await restore(w.dave);
  });

  it('un motif vide est enregistré comme absent, un motif trop long est coupé à 500 caractères', async () => {
    await suspend(w.dave, '   ');
    expect((await row(w.dave)).reason).toBeNull();
    await restore(w.dave);
    await suspend(w.dave, 'x'.repeat(900));
    expect((await row(w.dave)).reason).toHaveLength(500);
    await restore(w.dave);
  });

  it('suspendre deux fois garde la date et le motif d’origine', async () => {
    await suspend(w.dave, 'premier motif');
    const first = await row(w.dave);
    await suspend(w.dave, 'second motif');
    expect(await row(w.dave)).toEqual(first);
    await restore(w.dave);
  });

  it('refuse un utilisateur ordinaire, soi-même, un administrateur de la plateforme et un inconnu', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select public.admin_suspend_user($1)', [w.bob]))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, w.alice, () => q(db, 'select public.admin_restore_user($1)', [w.bob]))).rejects.toThrow(/forbidden/);
    await expect(suspend(owner)).rejects.toThrow(/cannot suspend yourself/);
    const other = await createUser(db, 'other-owner@postbiz.test');
    await asService(db, () => q(db, 'insert into public.platform_admins (user_id) values ($1)', [other]));
    await expect(suspend(other)).rejects.toThrow(/cannot suspend a platform admin/);
    await expect(suspend('00000000-0000-0000-0000-00000000dead')).rejects.toThrow(/user not found/);
    await expect(asAnon(db, () => q(db, 'select public.admin_suspend_user($1)', [w.bob]))).rejects.toThrow(/permission denied/);
    expect(await q(db, 'select 1 from public.user_suspensions')).toHaveLength(0);
  });

  it('rétablir supprime la suspension et lève le blocage de connexion', async () => {
    await suspend(w.dave);
    await restore(w.dave);
    expect(await row(w.dave)).toBeUndefined();
    expect((await q<{ b: string | null }>(db, 'select banned_until as b from auth.users where id = $1', [w.dave]))[0]!.b).toBeNull();
  });
});

describe('un compte suspendu n’accède plus aux données', () => {
  const seen = (user: string, sql: string) => asUser(db, user, () => q(db, sql));

  it('ne voit plus son organisation, ses canaux, ses publications ni ses collègues', async () => {
    await q(db, `insert into public.posts (org_id, integration_id, created_by, content, state) values ($1,$2,$3,'Brouillon','draft')`, [w.orgA, w.intA, w.carol]);
    expect((await seen(w.carol, 'select * from public.organizations')).length).toBe(1);
    expect((await seen(w.carol, 'select * from public.posts')).length).toBeGreaterThan(0);

    await suspend(w.carol);
    for (const table of ['organizations', 'memberships', 'integrations', 'posts', 'media', 'conversations', 'messages', 'subscriptions']) {
      expect(await seen(w.carol, `select * from public.${table}`), table).toHaveLength(0);
    }
    expect((await seen(w.carol, 'select * from public.profiles')).map((r: any) => r.id)).toEqual([w.carol]); // seulement le sien

    // Les autres membres de l'organisation ne sont pas touchés.
    expect((await seen(w.alice, 'select * from public.organizations')).length).toBe(1);
    expect((await seen(w.alice, 'select * from public.profiles')).length).toBeGreaterThan(1);
  });

  it('ne peut plus rien écrire, même avec un jeton encore valide', async () => {
    await expect(asUser(db, w.carol, () => q(db,
      `insert into public.posts (org_id, integration_id, created_by, content, state) values ($1,$2,$3,'Pirate','draft')`, [w.orgA, w.intA, w.carol]))).rejects.toThrow(/row-level security/);
    expect(await asUser(db, w.carol, () => q(db, `update public.organizations set name = 'Piraté' where id = $1 returning id`, [w.orgA]))).toHaveLength(0);
  });

  it('ne peut pas se recréer une organisation', async () => {
    const lonely = await createUser(db, 'lonely@x.test');
    await asService(db, () => q(db, `insert into public.user_suspensions (user_id) values ($1)`, [lonely]));
    await expect(asUser(db, lonely, () => q(db, 'select public.ensure_organization()'))).rejects.toThrow(/account suspended/);
    expect(await q(db, 'select 1 from public.memberships where user_id = $1', [lonely])).toHaveLength(0);
    await q(db, 'delete from public.user_suspensions where user_id = $1', [lonely]);
  });

  it('is_suspended() répond pour soi seulement ; la fonction interne est fermée aux clients', async () => {
    const mine = (user: string) => asUser(db, user, async () => (await q<{ v: boolean }>(db, 'select public.is_suspended() as v'))[0]!.v);
    expect(await mine(w.carol)).toBe(true);
    expect(await mine(w.alice)).toBe(false);
    await expect(asUser(db, w.alice, () => q(db, 'select public.user_is_suspended($1)', [w.carol]))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => q(db, 'select public.is_suspended()'))).rejects.toThrow(/permission denied/);
  });

  it('rétabli, il retrouve tout', async () => {
    await restore(w.carol);
    expect((await seen(w.carol, 'select * from public.organizations')).length).toBe(1);
    expect((await seen(w.carol, 'select * from public.posts')).length).toBeGreaterThan(0);
  });

  it('personne ne lit ni n’écrit la table des suspensions par l’API', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select * from public.user_suspensions'))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.carol, () => q(db, 'delete from public.user_suspensions'))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, owner, () => q(db, 'select * from public.user_suspensions'))).rejects.toThrow(/permission denied/);
  });
});

describe('le worker n’envoie plus pour un compte suspendu', () => {
  const queued = async (by: string) =>
    (await q<{ id: string }>(db,
      `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at)
       values ($1,$2,$3,'À publier','queued', now() - interval '1 minute') returning id`, [w.orgA, w.intA, by]))[0]!.id;
  const claimedPosts = () => asService(db, async () => (await q<{ id: string }>(db, 'select id from public.claim_due_posts(50, 60)')).map((r) => r.id));

  it('ne réclame pas les publications d’un suspendu, mais réclame les autres', async () => {
    const mine = await queued(w.carol);
    const others = await queued(w.alice);
    await suspend(w.carol);
    const claimed = await claimedPosts();
    expect(claimed).toContain(others);
    expect(claimed).not.toContain(mine);
    expect((await q<{ state: string }>(db, 'select state from public.posts where id = $1', [mine]))[0]!.state).toBe('queued');
  });

  it('les réclame de nouveau au rétablissement', async () => {
    const { id } = (await q<{ id: string }>(db, `select id from public.posts where state = 'queued' and created_by = $1`, [w.carol]))[0]!;
    await restore(w.carol);
    expect(await claimedPosts()).toContain(id);
  });

  it('ne réclame pas les premiers commentaires d’un suspendu', async () => {
    const insert = async (by: string) =>
      (await q<{ id: string }>(db,
        `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at, first_comment)
         values ($1,$2,$3,'Publié','published', now(), 'Le lien') returning id`, [w.orgA, w.intA, by]))[0]!.id;
    const mine = await insert(w.carol);
    const others = await insert(w.alice);
    await suspend(w.carol);
    const claimed = await asService(db, async () => (await q<{ id: string }>(db, 'select id from public.claim_first_comments(50, 60)')).map((r) => r.id));
    expect(claimed).toContain(others);
    expect(claimed).not.toContain(mine);
    await restore(w.carol);
  });

  it('ne réclame pas les réponses en file d’un suspendu', async () => {
    const r = (await q<{ o_conversation_id: string }>(db,
      `select * from public.ingest_message($1,'dm','thread-s','user-1','Léa','lea','http://img/lea.png','m1','in','Bonjour','[]'::jsonb, now(), null, null)`, [w.intA]))[0]!;
    const reply = async (by: string) =>
      (await q<{ id: string }>(db,
        `insert into public.messages (org_id, conversation_id, direction, body, sent_by, delivery_status)
         values ($1,$2,'out','Réponse',$3,'queued') returning id`, [w.orgA, r.o_conversation_id, by]))[0]!.id;
    const mine = await reply(w.carol);
    const others = await reply(w.alice);
    await suspend(w.carol);
    const claimed = await asService(db, async () => (await q<{ id: string }>(db, 'select id from public.claim_outbound_messages(50, 60)')).map((x) => x.id));
    expect(claimed).toContain(others);
    expect(claimed).not.toContain(mine);
    await restore(w.carol);
    expect(await asService(db, async () => (await q<{ id: string }>(db, 'select id from public.claim_outbound_messages(50, 60)')).map((x) => x.id))).toContain(mine);
  });
});

describe('espace propriétaire', () => {
  it('la liste des utilisateurs indique les comptes suspendus', async () => {
    await suspend(w.dave, 'litige');
    const rows = await admin(() => q<any>(db, 'select email, suspended from public.admin_users()'));
    expect(rows.filter((r: any) => r.suspended).map((r: any) => r.email)).toEqual(['dave@a.test']);
    await restore(w.dave);
    expect((await admin(() => q<any>(db, 'select * from public.admin_users()'))).some((r: any) => r.suspended)).toBe(false);
  });

  it('admin_user_status donne le motif, la date, l’auteur et si le compte est protégé', async () => {
    await suspend(w.dave, 'litige');
    const status = (id: string) => admin(async () => (await q<{ s: any }>(db, 'select public.admin_user_status($1) as s', [id]))[0]!.s);
    const s = await status(w.dave);
    expect(s.suspension).toMatchObject({ reason: 'litige', by_email: 'owner@postbiz.test' });
    expect(s.suspension.at).toBeTruthy();
    expect(s.is_platform_admin).toBe(false);
    expect((await status(w.alice)).suspension).toBeNull();
    expect((await status(owner)).is_platform_admin).toBe(true);
    await restore(w.dave);
    await expect(asUser(db, w.alice, () => q(db, 'select public.admin_user_status($1)', [w.dave]))).rejects.toThrow(/forbidden/);
  });
});
