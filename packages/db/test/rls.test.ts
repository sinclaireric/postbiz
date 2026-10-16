import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const insertPost = (org: string, integration: string, by: string, state = 'draft') =>
  q(db, `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at)
         values ($1,$2,$3,'Bonjour',$4, now() + interval '1 day') returning id`, [org, integration, by, state]);

describe('isolation multi-tenant', () => {
  it('chaque utilisateur ne voit que son organisation', async () => {
    const a = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.organizations'));
    const b = await asUser(db, w.bob, () => q<{ id: string }>(db, 'select id from public.organizations'));
    expect(a.map((r) => r.id)).toEqual([w.orgA]);
    expect(b.map((r) => r.id)).toEqual([w.orgB]);
  });

  it('les canaux de l’autre organisation sont invisibles', async () => {
    const rows = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.integrations'));
    expect(rows.map((r) => r.id)).toEqual([w.intA]);
  });

  it('un visiteur anonyme ne lit rien', async () => {
    await expect(asAnon(db, () => q(db, 'select * from public.organizations'))).rejects.toThrow(/permission denied/);
  });

  it('create_organization exige une session', async () => {
    await expect(q(db, `select public.create_organization('X')`)).rejects.toThrow(/not authenticated/);
  });

  it('les profils sont visibles au sein d’une organisation, pas entre organisations', async () => {
    const names = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.profiles'));
    const ids = names.map((r) => r.id).sort();
    expect(ids).toEqual([w.alice, w.carol, w.dave].sort());
    expect(ids).not.toContain(w.bob);
  });
});

describe('secrets des canaux', () => {
  it('integration_secrets est inaccessible aux clients', async () => {
    await q(db, `insert into public.integration_secrets (integration_id, access_token_enc) values ($1, 'enc')`, [w.intA]);
    await expect(asUser(db, w.alice, () => q(db, 'select * from public.integration_secrets'))).rejects.toThrow(/permission denied/);
  });

  it('un client ne peut pas écrire dans integrations', async () => {
    await expect(
      asUser(db, w.alice, () =>
        q(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1,'x','x1','X')`, [w.orgA]))
    ).rejects.toThrow(/permission denied/);
  });
});

describe('membres et rôles', () => {
  it('seul un admin ajoute des membres', async () => {
    const eve = (await q<{ id: string }>(db, `insert into auth.users (email) values ('eve@x.test') returning id`))[0]!.id;
    await expect(
      asUser(db, w.carol, () => q(db, `insert into public.memberships (org_id, user_id) values ($1,$2)`, [w.orgA, eve]))
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, w.alice, () => q(db, `insert into public.memberships (org_id, user_id) values ($1,$2)`, [w.orgB, eve]))
    ).rejects.toThrow(/row-level security/);
    await asUser(db, w.alice, () => q(db, `insert into public.memberships (org_id, user_id) values ($1,$2)`, [w.orgA, eve]));
  });

  it('un membre ne peut pas se promouvoir admin', async () => {
    const rows = await asUser(db, w.carol, () =>
      q(db, `update public.memberships set role = 'admin' where user_id = $1 returning user_id`, [w.carol]));
    expect(rows).toHaveLength(0);
  });
});

describe('publications', () => {
  it('un membre crée un brouillon ou un post en file', async () => {
    await asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.carol, 'draft'));
    await asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.carol, 'queued'));
  });

  it('un lecteur ne peut pas créer de post', async () => {
    await expect(asUser(db, w.dave, () => insertPost(w.orgA, w.intA, w.dave))).rejects.toThrow(/row-level security/);
  });

  it('un client ne peut pas créer un post déjà publié ni usurper un autre auteur', async () => {
    await expect(asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.carol, 'published'))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.alice))).rejects.toThrow(/row-level security/);
  });

  it('on ne peut pas publier vers le canal d’une autre organisation', async () => {
    await expect(asUser(db, w.carol, () => insertPost(w.orgA, w.intB, w.carol))).rejects.toThrow(/row-level security/);
  });

  it('un client ne peut pas écrire l’état d’exécution', async () => {
    const { id } = ((await asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.carol))) as { id: string }[])[0]!;
    await expect(
      asUser(db, w.carol, () => q(db, `update public.posts set attempts = 5 where id = $1`, [id]))
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, w.carol, () => q(db, `update public.posts set state = 'published' where id = $1`, [id]))
    ).rejects.toThrow(/row-level security/);
  });

  it('un post publié n’est plus modifiable par un client', async () => {
    const { id } = ((await asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.carol))) as { id: string }[])[0]!;
    await q(db, `update public.posts set state = 'published' where id = $1`, [id]);
    const rows = await asUser(db, w.carol, () =>
      q(db, `update public.posts set content = 'modifié' where id = $1 returning id`, [id]));
    expect(rows).toHaveLength(0);
  });

  it('un membre supprime (soft delete) un brouillon, pas un post publié', async () => {
    const { id } = ((await asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.carol))) as { id: string }[])[0]!;
    await asUser(db, w.carol, () => q(db, `update public.posts set deleted_at = now() where id = $1`, [id]));
    const visible = await asUser(db, w.carol, () => q(db, 'select id from public.posts where id = $1 and deleted_at is null', [id]));
    expect(visible).toHaveLength(0);

    const { id: pub } = ((await asUser(db, w.carol, () => insertPost(w.orgA, w.intA, w.carol))) as { id: string }[])[0]!;
    await q(db, `update public.posts set state = 'published' where id = $1`, [pub]);
    const rows = await asUser(db, w.carol, () => q(db, `update public.posts set deleted_at = now() where id = $1 returning id`, [pub]));
    expect(rows).toHaveLength(0);
  });

  it('les posts de l’autre organisation sont invisibles', async () => {
    await insertPost(w.orgB, w.intB, w.bob);
    const rows = await asUser(db, w.alice, () => q<{ org_id: string }>(db, 'select org_id from public.posts'));
    expect(rows.every((r) => r.org_id === w.orgA)).toBe(true);
  });

  it('un post en file doit avoir une date', async () => {
    await expect(
      q(db, `insert into public.posts (org_id, integration_id, state) values ($1,$2,'queued')`, [w.orgA, w.intA])
    ).rejects.toThrow(/posts_queued_needs_date/);
  });
});

describe('inbox (RLS)', () => {
  let conv: string;
  let convB: string;

  beforeAll(async () => {
    const mk = async (integration: string, ext: string) =>
      (await q<{ o_conversation_id: string }>(db,
        `select * from public.ingest_message($1,'dm',$2,'u1','Client',null,null,$3,'in','Salut',null,now())`,
        [integration, `t-${ext}`, `m-${ext}`]))[0]!.o_conversation_id;
    conv = await mk(w.intA, 'a');
    convB = await mk(w.intB, 'b');
  });

  it('les conversations sont cloisonnées par organisation', async () => {
    const rows = await asUser(db, w.alice, () => q<{ id: string }>(db, 'select id from public.conversations'));
    expect(rows.map((r) => r.id)).toContain(conv);
    expect(rows.map((r) => r.id)).not.toContain(convB);
  });

  it('un agent change le statut mais pas les autres colonnes', async () => {
    const ok = await asUser(db, w.carol, () =>
      q(db, `update public.conversations set status = 'pending' where id = $1 returning id`, [conv]));
    expect(ok).toHaveLength(1);
    await expect(
      asUser(db, w.carol, () => q(db, `update public.conversations set org_id = $2 where id = $1`, [conv, w.orgB]))
    ).rejects.toThrow(/permission denied/);
  });

  it('l’assignation est limitée aux membres de l’organisation', async () => {
    await expect(
      asUser(db, w.alice, () => q(db, `update public.conversations set assignee_id = $2 where id = $1`, [conv, w.bob]))
    ).rejects.toThrow(/row-level security/);
    const rows = await asUser(db, w.alice, () =>
      q(db, `update public.conversations set assignee_id = $2 where id = $1 returning id`, [conv, w.carol]));
    expect(rows).toHaveLength(1);
  });

  it('un lecteur ne peut pas modifier une conversation', async () => {
    const rows = await asUser(db, w.dave, () =>
      q(db, `update public.conversations set status = 'closed' where id = $1 returning id`, [conv]));
    expect(rows).toHaveLength(0);
  });

  const reply = (by: string, conversation: string, org: string, opts: { sentBy?: string; direction?: string; status?: string } = {}) =>
    q(db, `insert into public.messages (org_id, conversation_id, direction, body, sent_by, delivery_status)
           values ($1,$2,$3,'Réponse',$4,$5) returning id`,
      [org, conversation, opts.direction ?? 'out', opts.sentBy ?? by, opts.status ?? 'queued']);

  it('un agent met une réponse en file à son nom', async () => {
    await asUser(db, w.carol, () => reply(w.carol, conv, w.orgA));
  });

  it('un agent ne peut ni forger un message entrant, ni usurper, ni écrire chez l’autre org, ni marquer « sent »', async () => {
    await expect(asUser(db, w.carol, () => reply(w.carol, conv, w.orgA, { direction: 'in' }))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.carol, () => reply(w.carol, conv, w.orgA, { sentBy: w.alice }))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.carol, () => reply(w.carol, convB, w.orgB))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.carol, () => reply(w.carol, conv, w.orgA, { status: 'sent' }))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.dave, () => reply(w.dave, conv, w.orgA))).rejects.toThrow(/row-level security/);
  });

  it('les messages ne sont ni modifiables ni supprimables par un client', async () => {
    await expect(asUser(db, w.alice, () => q(db, `update public.messages set body = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `delete from public.messages`))).rejects.toThrow(/permission denied/);
  });

  it('les événements bruts des webhooks sont inaccessibles', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select * from public.inbox_events_raw'))).rejects.toThrow(/permission denied/);
  });

  it('les notes internes : lecture par l’équipe, écriture à son nom', async () => {
    await asUser(db, w.carol, () =>
      q(db, `insert into public.conversation_notes (org_id, conversation_id, author_id, body) values ($1,$2,$3,'À rappeler')`,
        [w.orgA, conv, w.carol]));
    await expect(
      asUser(db, w.carol, () =>
        q(db, `insert into public.conversation_notes (org_id, conversation_id, author_id, body) values ($1,$2,$3,'x')`,
          [w.orgA, conv, w.alice]))
    ).rejects.toThrow(/row-level security/);
    const rows = await asUser(db, w.dave, () => q(db, 'select * from public.conversation_notes'));
    expect(rows).toHaveLength(1);
  });

  it('la recherche plein texte trouve un message', async () => {
    const rows = await asUser(db, w.alice, () =>
      q(db, `select id from public.messages where body_tsv @@ plainto_tsquery('simple', 'salut')`));
    expect(rows.length).toBeGreaterThan(0);
  });
});
