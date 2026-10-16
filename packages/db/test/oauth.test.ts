import { beforeEach, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeEach(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const connect = (o: Partial<{ org: string; provider: string; internalId: string; name: string; settings: object; expires: string | null; access: string; refresh: string | null }> = {}) =>
  asService(db, () =>
    q<{ id: string }>(
      db,
      `select public.connect_integration($1, $2::public.social_provider, $3, $4, 'user', 'http://img', $5::jsonb, $6::timestamptz, $7, $8) as id`,
      [o.org ?? w.orgA, o.provider ?? 'x', o.internalId ?? 'x-1', o.name ?? 'Compte X', JSON.stringify(o.settings ?? {}), o.expires === undefined ? null : o.expires, o.access ?? 'ENC-A', o.refresh === undefined ? 'ENC-R' : o.refresh]
    ).then((r) => r[0]!.id)
  );

const secrets = (id: string) => q<{ access_token_enc: string; refresh_token_enc: string | null }>(db, 'select * from public.integration_secrets where integration_id = $1', [id]);
const integ = (id: string) => q<Record<string, any>>(db, 'select * from public.integrations where id = $1', [id]).then((r) => r[0]!);

describe('tables OAuth : aucun accès client', () => {
  it('oauth_states et oauth_pending_selections sont fermées à anon et authenticated', async () => {
    for (const table of ['oauth_states', 'oauth_pending_selections']) {
      await expect(asUser(db, w.alice, () => q(db, `select * from public.${table}`))).rejects.toThrow(/permission denied/);
      await expect(asAnon(db, () => q(db, `select * from public.${table}`))).rejects.toThrow(/permission denied/);
      await expect(asUser(db, w.alice, () => q(db, `delete from public.${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it('le service_role y écrit, et la ligne expire toute seule', async () => {
    await asService(db, () =>
      q(db, `insert into public.oauth_states (state_hash, user_id, org_id, network) values ('h1', $1, $2, 'x')`, [w.alice, w.orgA]));
    const [row] = await q<{ expires_at: string; created_at: string }>(db, `select expires_at, created_at from public.oauth_states`);
    expect(new Date(row!.expires_at).getTime() - new Date(row!.created_at).getTime()).toBeGreaterThan(5 * 60_000);
  });

  it('les fonctions de connexion sont réservées au service_role', async () => {
    for (const sql of [
      `select public.connect_integration($1,'x','z','Z',null,null,'{}',null,'e',null)`,
      `select public.disconnect_integration($1, $2)`,
      `select * from public.claim_token_refresh(array['x']::public.social_provider[])`,
      `select public.purge_expired_oauth()`,
    ]) {
      const params = sql.includes('$2') ? [w.orgA, w.intA] : sql.includes('$1') ? [w.orgA] : [];
      await expect(asUser(db, w.alice, () => q(db, sql, params))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('connect_integration', () => {
  it('crée le canal et son jeton chiffré ensemble', async () => {
    const id = await connect({ expires: '2030-01-01T00:00:00Z' });
    const i = await integ(id);
    expect(i).toMatchObject({ org_id: w.orgA, provider: 'x', internal_id: 'x-1', name: 'Compte X', status: 'active', deleted_at: null });
    expect(await secrets(id)).toEqual([{ integration_id: id, access_token_enc: 'ENC-A', refresh_token_enc: 'ENC-R', updated_at: expect.anything() }]);
    // visible par les membres de l'organisation, jamais le jeton
    const visible = await asUser(db, w.carol, () => q(db, 'select id from public.integrations where id = $1', [id]));
    expect(visible).toHaveLength(1);
  });

  it('une reconnexion réactive un canal supprimé ou à reconnecter, fusionne les réglages et garde le refresh token si aucun nouveau', async () => {
    const id = await connect({ settings: { page_id: 'P1', human_agent_enabled: true } });
    await asService(db, () => q(db, `update public.integrations set status = 'refresh_needed' where id = $1`, [id]));
    await asService(db, () => q(db, `select public.disconnect_integration($1,$2)`, [w.orgA, id]));
    const again = await connect({ settings: { page_id: 'P2' }, access: 'ENC-B', refresh: null });
    expect(again).toBe(id);
    const i = await integ(id);
    expect(i).toMatchObject({ status: 'active', deleted_at: null });
    expect(i.settings).toEqual({ page_id: 'P2', human_agent_enabled: true });
    expect(await secrets(id)).toMatchObject([{ access_token_enc: 'ENC-B', refresh_token_enc: null }]);
  });

  it('deux organisations peuvent connecter le même compte sans se voir', async () => {
    const a = await connect({ org: w.orgA });
    const b = await connect({ org: w.orgB });
    expect(a).not.toBe(b);
  });
});

describe('disconnect_integration', () => {
  it('supprime les jetons, marque le canal supprimé et fait échouer les publications en attente', async () => {
    const id = await connect();
    await q(db, `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at) values ($1,$2,$3,'a','queued', now() + interval '1 day'), ($1,$2,$3,'b','draft', null)`, [w.orgA, id, w.alice]);
    const ok = await asService(db, () => q<{ disconnect_integration: boolean }>(db, `select public.disconnect_integration($1,$2)`, [w.orgA, id]));
    expect(ok[0]!.disconnect_integration).toBe(true);
    expect(await secrets(id)).toHaveLength(0);
    expect((await integ(id)).deleted_at).not.toBeNull();
    const states = await q<{ content: string; state: string; error: string | null }>(db, `select content, state, error from public.posts order by content`);
    expect(states).toMatchObject([{ content: 'a', state: 'error', error: expect.stringContaining('déconnecté') }, { content: 'b', state: 'draft', error: null }]);
    // plus visible côté client
    expect(await asUser(db, w.alice, () => q(db, 'select id from public.integrations where id = $1', [id]))).toHaveLength(0);
  });

  it('refuse un canal d’une autre organisation', async () => {
    const id = await connect({ org: w.orgB });
    const ok = await asService(db, () => q<{ disconnect_integration: boolean }>(db, `select public.disconnect_integration($1,$2)`, [w.orgA, id]));
    expect(ok[0]!.disconnect_integration).toBe(false);
    expect(await secrets(id)).toHaveLength(1);
    expect((await integ(id)).deleted_at).toBeNull();
  });
});

describe('rafraîchissement des jetons', () => {
  const claim = (providers = ['x', 'linkedin', 'youtube', 'tiktok'], within = 1800) =>
    asService(db, () => q<{ id: string; refresh_token_enc: string }>(db, `select * from public.claim_token_refresh($1::public.social_provider[], $2, 300, 20)`, [`{${providers.join(',')}}`, within]));
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

  it('ne réclame que les jetons proches de l’expiration, actifs, avec refresh token, des réseaux demandés', async () => {
    const soon = await connect({ internalId: 'soon', expires: inMinutes(10) });
    await connect({ internalId: 'later', expires: inMinutes(600) });
    await connect({ internalId: 'never', expires: null });
    await connect({ internalId: 'norefresh', expires: inMinutes(5), refresh: null });
    const other = await connect({ internalId: 'ig', provider: 'instagram', expires: inMinutes(5) });
    const needs = await connect({ internalId: 'needs', expires: inMinutes(5) });
    await q(db, `update public.integrations set status = 'refresh_needed' where id = $1`, [needs]);
    const gone = await connect({ internalId: 'gone', expires: inMinutes(5) });
    await asService(db, () => q(db, `select public.disconnect_integration($1,$2)`, [w.orgA, gone]));

    const rows = await claim();
    expect(rows.map((r) => r.id)).toEqual([soon]);
    expect(rows[0]!.refresh_token_enc).toBe('ENC-R');
    expect(await claim(['instagram'])).toHaveLength(1);
    expect(other).toBeTruthy();
  });

  it('le verrou empêche un second worker de réclamer le même jeton, puis expire', async () => {
    const id = await connect({ expires: inMinutes(5) });
    expect(await claim()).toHaveLength(1);
    expect(await claim()).toHaveLength(0);
    await q(db, `update public.integrations set refresh_locked_until = now() - interval '1 second' where id = $1`, [id]);
    expect(await claim()).toHaveLength(1);
  });

  it('complete_token_refresh remplace les jetons et libère le verrou ; refresh null = inchangé', async () => {
    const id = await connect({ expires: inMinutes(5) });
    await claim();
    const ok = await asService(db, () => q<{ complete_token_refresh: boolean }>(db, `select public.complete_token_refresh($1,'ENC-A2',null,$2)`, [id, inMinutes(120)]));
    expect(ok[0]!.complete_token_refresh).toBe(true);
    expect(await secrets(id)).toMatchObject([{ access_token_enc: 'ENC-A2', refresh_token_enc: 'ENC-R' }]);
    const i = await integ(id);
    expect(i.refresh_locked_until).toBeNull();
    expect(new Date(i.token_expires_at).getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
    await asService(db, () => q(db, `select public.complete_token_refresh($1,'ENC-A3','ENC-R3',$2)`, [id, inMinutes(120)]));
    expect(await secrets(id)).toMatchObject([{ access_token_enc: 'ENC-A3', refresh_token_enc: 'ENC-R3' }]);
  });

  it('ne ressuscite jamais les jetons d’un canal déconnecté pendant le rafraîchissement', async () => {
    const id = await connect({ expires: inMinutes(5) });
    await claim();
    await asService(db, () => q(db, `select public.disconnect_integration($1,$2)`, [w.orgA, id]));
    const ok = await asService(db, () => q<{ complete_token_refresh: boolean }>(db, `select public.complete_token_refresh($1,'ENC-NEW','ENC-R2',$2)`, [id, inMinutes(120)]));
    expect(ok[0]!.complete_token_refresh).toBe(false);
    expect(await secrets(id)).toHaveLength(0);
  });

  it('un échec définitif passe le canal en « refresh_needed » ; un échec passager ne change rien', async () => {
    const a = await connect({ internalId: 'a', expires: inMinutes(5) });
    const b = await connect({ internalId: 'b', expires: inMinutes(5) });
    await claim();
    await asService(db, () => q(db, `select public.fail_token_refresh($1,true)`, [a]));
    await asService(db, () => q(db, `select public.fail_token_refresh($1,false)`, [b]));
    expect((await integ(a)).status).toBe('refresh_needed');
    expect((await integ(b)).status).toBe('active');
    expect((await integ(b)).refresh_locked_until).not.toBeNull(); // le verrou expirera, puis nouvel essai
  });

  it('expire_unrefreshable_integrations ne touche que les jetons échus sans refresh token', async () => {
    const dead = await connect({ internalId: 'dead', provider: 'linkedin', expires: inMinutes(-5), refresh: null });
    await connect({ internalId: 'valid', provider: 'linkedin', expires: inMinutes(60 * 24), refresh: null });
    await connect({ internalId: 'refreshable', expires: inMinutes(-5) });
    const rows = await asService(db, () => q<{ id: string }>(db, `select * from public.expire_unrefreshable_integrations()`));
    expect(rows.map((r) => r.id)).toEqual([dead]);
    expect((await integ(dead)).status).toBe('refresh_needed');
  });

  it('un canal à reconnecter n’est plus utilisé par la file d’envoi', async () => {
    const id = await connect({ expires: inMinutes(-5), refresh: null });
    await asService(db, () => q(db, `select * from public.expire_unrefreshable_integrations()`));
    await q(db, `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at) values ($1,$2,$3,'a','queued', now() - interval '1 minute')`, [w.orgA, id, w.alice]);
    expect(await asService(db, () => q(db, `select * from public.claim_due_posts(10, 60)`))).toHaveLength(0);
  });
});

describe('purge_expired_oauth', () => {
  it('supprime les connexions abandonnées et garde les autres', async () => {
    await asService(db, () => q(db, `insert into public.oauth_states (state_hash, user_id, org_id, network, expires_at) values ('old',$1,$2,'x', now() - interval '1 minute'), ('new',$1,$2,'x', default)`, [w.alice, w.orgA]));
    await asService(db, () => q(db, `insert into public.oauth_pending_selections (user_id, org_id, network, payload_enc, expires_at) values ($1,$2,'facebook','e', now() - interval '1 minute'), ($1,$2,'facebook','e', default)`, [w.alice, w.orgA]));
    const n = await asService(db, () => q<{ purge_expired_oauth: number }>(db, `select public.purge_expired_oauth()`));
    expect(n[0]!.purge_expired_oauth).toBe(2);
    expect(await q(db, 'select 1 from public.oauth_states')).toHaveLength(1);
    expect(await q(db, 'select 1 from public.oauth_pending_selections')).toHaveLength(1);
  });
});
