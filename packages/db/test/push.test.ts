import { beforeEach, describe, expect, it } from 'vitest';
import { asAnon, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeEach(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const claim = (userId: string, token: string, platform = 'ios') =>
  asUser(db, userId, () => q(db, 'select public.claim_push_token($1, $2)', [token, platform]));
const tokensOf = (userId: string) => q<{ token: string; platform: string }>(db, 'select token, platform from public.push_tokens where user_id = $1 order by token', [userId]);

describe('claim_push_token', () => {
  it('enregistre le jeton de l’utilisateur connecté', async () => {
    await claim(w.alice, 'ExponentPushToken[a]');
    expect(await tokensOf(w.alice)).toEqual([{ token: 'ExponentPushToken[a]', platform: 'ios' }]);
  });

  it('est idempotente et met la plateforme à jour', async () => {
    await claim(w.alice, 'ExponentPushToken[a]', 'ios');
    await claim(w.alice, 'ExponentPushToken[a]', 'android');
    expect(await tokensOf(w.alice)).toEqual([{ token: 'ExponentPushToken[a]', platform: 'android' }]);
  });

  it('reprend un jeton lié à un autre compte (appareil prêté) — ce que le upsert client ne peut pas faire', async () => {
    await claim(w.alice, 'ExponentPushToken[shared]');
    // Sans le RPC : la RLS (user_id = auth.uid()) empêche d'écraser la ligne d'un autre compte.
    await expect(
      asUser(db, w.bob, () =>
        q(db, `insert into public.push_tokens (user_id, token, platform) values ($1, 'ExponentPushToken[shared]', 'ios') on conflict (token) do update set user_id = excluded.user_id`, [w.bob])
      )
    ).rejects.toThrow();
    expect(await tokensOf(w.bob)).toEqual([]);

    await claim(w.bob, 'ExponentPushToken[shared]');
    expect(await tokensOf(w.bob)).toHaveLength(1);
    expect(await tokensOf(w.alice)).toEqual([]); // plus de push de Alice sur cet appareil
    expect(await q(db, `select 1 from public.push_tokens where token = 'ExponentPushToken[shared]'`)).toHaveLength(1);
  });

  it('ne touche pas aux autres jetons de l’ancien propriétaire', async () => {
    await claim(w.alice, 'ExponentPushToken[phone]');
    await claim(w.alice, 'ExponentPushToken[tablet]', 'android');
    await claim(w.bob, 'ExponentPushToken[phone]');
    expect((await tokensOf(w.alice)).map((t) => t.token)).toEqual(['ExponentPushToken[tablet]']);
  });

  it('refuse un jeton vide ou une plateforme inconnue', async () => {
    await expect(claim(w.alice, '   ')).rejects.toThrow(/invalid token/);
    await expect(claim(w.alice, 'ExponentPushToken[x]', 'windows')).rejects.toThrow(/invalid platform/);
    expect(await tokensOf(w.alice)).toEqual([]);
  });

  it('est fermée aux visiteurs anonymes', async () => {
    await expect(asAnon(db, () => q(db, `select public.claim_push_token('ExponentPushToken[z]', 'ios')`))).rejects.toThrow(/permission denied/);
  });
});

// Émulation de pg_net et du Vault (absents de PGlite) : on vérifie ce que le trigger enverrait.
async function installStubs(configured = true) {
  await db.exec(`
    create schema net;
    create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds int);
    create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint
    language plpgsql as $$ begin
      insert into net.calls (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds);
      return 1;
    end $$;
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
  `);
  if (configured) {
    await db.exec(`insert into vault.decrypted_secrets values
      ('push_function_url', 'https://proj.supabase.co/functions/v1/send-push'), ('push_function_secret', 's3cret')`);
  }
}
const calls = () => q<{ url: string; body: any; headers: any; timeout_milliseconds: number }>(db, 'select url, body, headers, timeout_milliseconds from net.calls order by id');

const notify = (userId: string, o: { title?: string; data?: object } = {}) =>
  q(db, `insert into public.notifications (user_id, org_id, type, title, body, data) values ($1, $2, 'message_failed', $3, 'Détail', $4::jsonb)`, [
    userId, w.orgA, o.title ?? 'Réponse non envoyée', JSON.stringify(o.data ?? {}),
  ]);
const ingest = (o: { msg: string; dir?: string; body?: string; attachments?: string }) =>
  q<{ o_conversation_id: string; o_message_id: string }>(
    db,
    `select * from public.ingest_message($1,'dm','thread-1','user-1','Léa','lea',null,$2,$3,$4,$5::jsonb,now(),null,null)`,
    [w.intA, o.msg, o.dir ?? 'in', o.body ?? 'Bonjour', o.attachments ?? '[]']
  ).then((r) => r[0]!);

describe('push_dispatch (triggers)', () => {
  it('ne fait rien — et ne casse rien — sans pg_net ni Vault (cas des tests et d’un projet non configuré)', async () => {
    await notify(w.alice);
    const r = await ingest({ msg: 'm1' });
    expect(r.o_message_id).toBeTruthy();
    expect(await q(db, 'select 1 from public.notifications')).toHaveLength(1);
  });

  it('ne fait rien tant que l’URL ou le secret manque dans le Vault', async () => {
    await installStubs(false);
    await db.exec(`insert into vault.decrypted_secrets values ('push_function_url', 'https://x/y')`);
    await notify(w.alice);
    expect(await calls()).toEqual([]);
  });

  it('notification : appelle la fonction avec le secret et la ligne au format Database Webhook', async () => {
    await installStubs();
    await notify(w.alice, { data: { conversationId: 'c-1' } });
    const [c, ...rest] = await calls();
    expect(rest).toEqual([]);
    expect(c!.url).toBe('https://proj.supabase.co/functions/v1/send-push');
    expect(c!.headers).toMatchObject({ 'x-push-secret': 's3cret', 'Content-Type': 'application/json' });
    expect(c!.body).toMatchObject({
      type: 'INSERT', schema: 'public', table: 'notifications', old_record: null,
      record: { user_id: w.alice, org_id: w.orgA, type: 'message_failed', title: 'Réponse non envoyée', body: 'Détail', data: { conversationId: 'c-1' } },
    });
    expect(c!.body.record.id).toBeTruthy();
  });

  it('une notification par destinataire => un appel par ligne (notifyAdmins insère en lot)', async () => {
    await installStubs();
    await q(db, `insert into public.notifications (user_id, org_id, type, title) values ($1,$3,'x','T'), ($2,$3,'x','T')`, [w.alice, w.carol, w.orgA]);
    expect((await calls()).map((c) => c.body.record.user_id).sort()).toEqual([w.alice, w.carol].sort());
  });

  it('message entrant (via ingest_message) : appel avec les seuls champs utiles', async () => {
    await installStubs();
    const r = await ingest({ msg: 'm1', body: 'Salut !', attachments: '[{"type":"image","url":"http://i/1.png"}]' });
    const [c, ...rest] = await calls();
    expect(rest).toEqual([]);
    expect(c!.body).toMatchObject({ type: 'INSERT', table: 'messages' });
    expect(c!.body.record).toEqual({
      id: r.o_message_id, org_id: w.orgA, conversation_id: r.o_conversation_id,
      direction: 'in', body: 'Salut !', has_attachments: true,
    });
  });

  it('tronque le corps à 500 caractères', async () => {
    await installStubs();
    await ingest({ msg: 'm1', body: 'x'.repeat(2000) });
    expect((await calls())[0]!.body.record.body).toHaveLength(500);
  });

  it('un message déjà ingéré (webhook rejoué) ne déclenche pas un second push', async () => {
    await installStubs();
    await ingest({ msg: 'm1' });
    await ingest({ msg: 'm1' });
    expect(await calls()).toHaveLength(1);
  });

  it('un message sortant ne déclenche rien', async () => {
    await installStubs();
    await ingest({ msg: 'm-out', dir: 'out' });
    expect(await calls()).toEqual([]);
  });

  it('un échec de pg_net n’empêche jamais l’écriture (le message est bien ingéré)', async () => {
    await installStubs();
    await db.exec(`create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint
      language plpgsql as $$ begin raise exception 'pg_net en panne'; end $$;`);
    const r = await ingest({ msg: 'm1' });
    expect(r.o_message_id).toBeTruthy();
    await notify(w.alice);
    expect(await q(db, 'select 1 from public.messages')).toHaveLength(1);
    expect(await q(db, 'select 1 from public.notifications')).toHaveLength(1);
  });

  it('un client ne peut pas appeler push_dispatch directement', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select public.push_dispatch()'))).rejects.toThrow(/permission denied/);
  });
});
