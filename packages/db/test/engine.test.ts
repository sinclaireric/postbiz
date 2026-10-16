import { beforeEach, describe, expect, it } from 'vitest';
import { asService, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeEach(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const ingest = (
  integration: string,
  o: { kind?: string; conv?: string; msg: string; dir?: string; body?: string; at?: string; target?: string }
) =>
  q<{ o_conversation_id: string; o_message_id: string; o_inserted: boolean }>(
    db,
    `select * from public.ingest_message($1,$2,$3,'user-1','Léa','lea','http://img/lea.png',$4,$5,$6,'[]'::jsonb,$7::timestamptz,null,$8)`,
    [integration, o.kind ?? 'dm', o.conv ?? 'thread-1', o.msg, o.dir ?? 'in', o.body ?? 'Bonjour', o.at ?? new Date().toISOString(), o.target ?? null]
  ).then((r) => r[0]!);

const conversation = async (id: string) =>
  (await q<Record<string, any>>(db, 'select * from public.conversations where id = $1', [id]))[0]!;

describe('ingest_message', () => {
  it('crée contact, conversation et message, avec 1 non-lu', async () => {
    const r = await ingest(w.intA, { msg: 'm1' });
    expect(r.o_inserted).toBe(true);
    const c = await conversation(r.o_conversation_id);
    expect(c.unread_count).toBe(1);
    expect(c.last_message_preview).toBe('Bonjour');
    expect(c.status).toBe('open');
    expect(await q(db, 'select * from public.contacts')).toHaveLength(1);
  });

  it('est idempotente : un webhook rejoué ne duplique rien', async () => {
    const first = await ingest(w.intA, { msg: 'm1' });
    const again = await ingest(w.intA, { msg: 'm1' });
    expect(again.o_inserted).toBe(false);
    expect(again.o_message_id).toBe(first.o_message_id);
    expect((await conversation(first.o_conversation_id)).unread_count).toBe(1);
    expect(await q(db, 'select id from public.messages')).toHaveLength(1);
  });

  it('regroupe les messages d’un même fil et compte les non-lus', async () => {
    const a = await ingest(w.intA, { msg: 'm1' });
    const b = await ingest(w.intA, { msg: 'm2', body: 'Vous êtes là ?' });
    expect(b.o_conversation_id).toBe(a.o_conversation_id);
    const c = await conversation(a.o_conversation_id);
    expect(c.unread_count).toBe(2);
    expect(c.last_message_preview).toBe('Vous êtes là ?');
  });

  it('ouvre la fenêtre de réponse de 24 h pour un message privé entrant', async () => {
    const at = '2026-10-16T10:00:00Z';
    const r = await ingest(w.intA, { msg: 'm1', at });
    const c = await conversation(r.o_conversation_id);
    expect(new Date(c.reply_window_expires_at).toISOString()).toBe('2026-10-17T10:00:00.000Z');
    expect(new Date(c.last_inbound_at).toISOString()).toBe('2026-10-16T10:00:00.000Z');
  });

  it('pas de fenêtre de réponse pour un commentaire, mais la cible est conservée', async () => {
    const r = await ingest(w.intA, { kind: 'comment_thread', conv: 'c-1', msg: 'cm1', target: 'post-9' });
    const c = await conversation(r.o_conversation_id);
    expect(c.reply_window_expires_at).toBeNull();
    expect(c.target_external_id).toBe('post-9');
    expect(c.kind).toBe('comment_thread');
  });

  it('un message sortant ne crée pas de non-lu et n’ouvre pas de fenêtre', async () => {
    const r = await ingest(w.intA, { msg: 'out1', dir: 'out', body: 'Merci !' });
    const c = await conversation(r.o_conversation_id);
    expect(c.unread_count).toBe(0);
    expect(c.reply_window_expires_at).toBeNull();
    const m = (await q<{ delivery_status: string }>(db, 'select delivery_status from public.messages'))[0]!;
    expect(m.delivery_status).toBe('sent');
  });

  it('rouvre une conversation fermée quand le client réécrit', async () => {
    const r = await ingest(w.intA, { msg: 'm1' });
    await q(db, `update public.conversations set status = 'closed' where id = $1`, [r.o_conversation_id]);
    await ingest(w.intA, { msg: 'm2' });
    expect((await conversation(r.o_conversation_id)).status).toBe('open');
  });

  it('un message ancien (rattrapage) ne remplace pas l’aperçu du plus récent', async () => {
    const r = await ingest(w.intA, { msg: 'new', body: 'récent', at: '2026-10-16T12:00:00Z' });
    await ingest(w.intA, { msg: 'old', body: 'ancien', at: '2026-10-16T08:00:00Z' });
    const c = await conversation(r.o_conversation_id);
    expect(c.last_message_preview).toBe('récent');
    expect(new Date(c.last_message_at).toISOString()).toBe('2026-10-16T12:00:00.000Z');
  });

  it('rejette un canal inconnu', async () => {
    await expect(ingest('00000000-0000-0000-0000-000000000000', { msg: 'x' })).rejects.toThrow(/unknown integration/);
  });

  it('n’est pas appelable par un client', async () => {
    await expect(asUser(db, w.alice, () => ingest(w.intA, { msg: 'x' }))).rejects.toThrow(/permission denied/);
  });
});

describe('file de publication', () => {
  const post = async (o: { integration?: string; at?: string; state?: string; parent?: string | null } = {}) =>
    (await q<{ id: string }>(db,
      `insert into public.posts (org_id, integration_id, state, publish_at, parent_post_id, content)
       values ($1,$2,$3, $4::timestamptz, $5, 'x') returning id`,
      [w.orgA, o.integration ?? w.intA, o.state ?? 'queued', o.at ?? '2020-01-01T00:00:00Z', o.parent ?? null]))[0]!.id;

  const claim = () => asService(db, () => q<{ id: string; state: string; attempts: number }>(db, 'select * from public.claim_due_posts(10, 60)'));

  it('ne réclame que les posts dus, une seule fois', async () => {
    const due = await post();
    await post({ at: '2999-01-01T00:00:00Z' });
    const first = await claim();
    expect(first.map((p) => p.id)).toEqual([due]);
    expect(first[0]!.state).toBe('publishing');
    expect(first[0]!.attempts).toBe(1);
    expect(await claim()).toHaveLength(0);
  });

  it('ignore les brouillons, les fils enfants et les canaux désactivés', async () => {
    const root = await post();
    await post({ state: 'draft' });
    await post({ parent: root });
    const other = (await q<{ id: string }>(db,
      `insert into public.integrations (org_id, provider, internal_id, name, status) values ($1,'x','x1','X','refresh_needed') returning id`, [w.orgA]))[0]!.id;
    await post({ integration: other });
    const claimed = await claim();
    expect(claimed.map((p) => p.id)).toEqual([root]);
  });

  it('n’est pas appelable par un client', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select * from public.claim_due_posts(1, 60)'))).rejects.toThrow(/permission denied/);
  });

  it('un post abandonné passe en « unknown » et n’est jamais rejoué', async () => {
    const id = await post();
    await claim();
    await q(db, `update public.posts set locked_until = now() - interval '1 minute' where id = $1`, [id]);
    const res = await asService(db, () => q<{ sweep_stale_work: Record<string, number> }>(db, 'select public.sweep_stale_work()'));
    expect(res[0]!.sweep_stale_work.posts_unknown).toBe(1);
    const p = (await q<{ state: string; error: string }>(db, 'select state, error from public.posts where id = $1', [id]))[0]!;
    expect(p.state).toBe('unknown');
    expect(p.error).toMatch(/inconnu/i);
    expect(await claim()).toHaveLength(0);
  });

  it('un post en cours de publication n’est pas balayé avant l’expiration de son verrou', async () => {
    const id = await post();
    await claim();
    await asService(db, () => q(db, 'select public.sweep_stale_work()'));
    const p = (await q<{ state: string }>(db, 'select state from public.posts where id = $1', [id]))[0]!;
    expect(p.state).toBe('publishing');
  });
});

describe('file d’envoi des messages', () => {
  const queueReply = async (conv: string, by = w.carol) =>
    asUser(db, by, async () =>
      (await q<{ id: string }>(db,
        `insert into public.messages (org_id, conversation_id, direction, body, sent_by, delivery_status)
         values ($1,$2,'out','Réponse',$3,'queued') returning id`, [w.orgA, conv, by]))[0]!.id);

  const claim = () => asService(db, () => q<{ id: string; delivery_status: string }>(db, 'select * from public.claim_outbound_messages(10, 60)'));

  it('réclame les messages en file, une seule fois', async () => {
    const r = await ingest(w.intA, { msg: 'm1' });
    const id = await queueReply(r.o_conversation_id);
    const first = await claim();
    expect(first.map((m) => m.id)).toEqual([id]);
    expect(first[0]!.delivery_status).toBe('sending');
    expect(await claim()).toHaveLength(0);
  });

  it('marque « sent » avec l’identifiant du réseau', async () => {
    const r = await ingest(w.intA, { msg: 'm1' });
    const id = await queueReply(r.o_conversation_id);
    await claim();
    await asService(db, () => q(db, `select public.complete_outbound_message($1, 'mid-42')`, [id]));
    const m = (await q<{ external_id: string; delivery_status: string }>(db, 'select external_id, delivery_status from public.messages where id = $1', [id]))[0]!;
    expect(m).toEqual({ external_id: 'mid-42', delivery_status: 'sent' });
  });

  it('fusionne avec l’écho du webhook arrivé avant la confirmation d’envoi (pas de doublon)', async () => {
    const r = await ingest(w.intA, { msg: 'm1' });
    const id = await queueReply(r.o_conversation_id);
    await claim();
    // L'écho du réseau arrive d'abord...
    await ingest(w.intA, { msg: 'mid-42', dir: 'out', body: 'Réponse' });
    // ...puis le worker confirme l'envoi.
    await asService(db, () => q(db, `select public.complete_outbound_message($1, 'mid-42')`, [id]));
    const rows = await q<{ external_id: string; sent_by: string | null }>(db,
      `select external_id, sent_by from public.messages where direction = 'out'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.external_id).toBe('mid-42');
    expect(rows[0]!.sent_by).toBe(w.carol); // l'auteur Postbiz est conservé
  });

  it('un envoi dont le résultat est inconnu passe en « failed » sans renvoi automatique', async () => {
    const r = await ingest(w.intA, { msg: 'm1' });
    const id = await queueReply(r.o_conversation_id);
    await claim();
    await q(db, `update public.messages set locked_until = now() - interval '1 minute' where id = $1`, [id]);
    await asService(db, () => q(db, 'select public.sweep_stale_work()'));
    const m = (await q<{ delivery_status: string }>(db, 'select delivery_status from public.messages where id = $1', [id]))[0]!;
    expect(m.delivery_status).toBe('failed');
    expect(await claim()).toHaveLength(0);
  });

  it('enregistre l’échec d’un envoi', async () => {
    const r = await ingest(w.intA, { msg: 'm1' });
    const id = await queueReply(r.o_conversation_id);
    await claim();
    await asService(db, () => q(db, `select public.fail_outbound_message($1, 'fenêtre de 24 h dépassée')`, [id]));
    const m = (await q<{ delivery_status: string; error: string }>(db, 'select delivery_status, error from public.messages where id = $1', [id]))[0]!;
    expect(m).toEqual({ delivery_status: 'failed', error: 'fenêtre de 24 h dépassée' });
  });
});

describe('temps réel', () => {
  it('les tables de l’inbox sont publiées', async () => {
    const rows = await q<{ tablename: string }>(db, `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
    expect(rows.map((r) => r.tablename).sort()).toEqual(['conversations', 'messages', 'notifications', 'posts']);
  });
});
