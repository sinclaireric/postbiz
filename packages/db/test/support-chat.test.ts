import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, asAnon, asService, asUser, createDb, createUser, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;
let owner: string; // propriétaire de la plateforme
let erin: string; // utilisatrice sans organisation, qui écrit au support

const admin = <T>(fn: () => Promise<T>) => asUser(db, owner, fn);
const as = <T>(user: string, fn: () => Promise<T>) => asUser(db, user, fn);
const send = (user: string, body: string, org: string | null = null) =>
  as(user, async () => (await q<{ id: string }>(db, 'select public.support_send($1, $2) as id', [body, org]))[0]!.id);
const conversationOf = async (user: string) => (await q<any>(db, 'select * from public.support_conversations where user_id = $1', [user]))[0];
const reply = (conversation: string, body: string) =>
  admin(async () => (await q<{ id: string }>(db, 'select public.admin_support_reply($1, $2) as id', [conversation, body]))[0]!.id);
const thread = (conversation: string, limit?: number) =>
  admin(async () => (await q<{ t: any }>(db, 'select public.admin_support_thread($1, $2) as t', [conversation, limit ?? null]))[0]!.t);
const list = (filter: string | null = null, search: string | null = null, limit = 25, offset = 0) =>
  admin(() => q<any>(db, 'select * from public.admin_support_conversations($1, $2, $3, $4)', [filter, search, limit, offset]));
const summary = () => admin(async () => (await q<{ s: any }>(db, 'select public.admin_support_summary() as s'))[0]!.s);
/** Recule d'une heure tous les messages d'un fil : vide la fenêtre de la limite de débit sans toucher au reste. */
const ageMessages = (conversation: string) =>
  q(db, `update public.support_messages set created_at = created_at - interval '1 hour' where conversation_id = $1`, [conversation]);

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
  owner = await createUser(db, 'owner@postbiz.test');
  await asService(db, () => q(db, 'insert into public.platform_admins (user_id) values ($1)', [owner]));
  erin = await createUser(db, 'erin@e.test');
});

describe('écrire au support', () => {
  it('le premier message crée la conversation de la personne, rattachée à son espace courant', async () => {
    await send(w.alice, 'Bonjour, je ne vois pas mon canal Instagram.', w.orgA);
    const c = await conversationOf(w.alice);
    expect(c).toMatchObject({ user_id: w.alice, org_id: w.orgA, status: 'open', support_unread: 1, user_unread: 0, last_author: 'user' });
    const msgs = await q<any>(db, 'select author, body from public.support_messages where conversation_id = $1', [c.id]);
    expect(msgs).toEqual([{ author: 'user', body: 'Bonjour, je ne vois pas mon canal Instagram.' }]);
  });

  it('une seule conversation par personne : les messages suivants s’y ajoutent', async () => {
    await send(w.alice, 'Un second message.');
    expect(await q(db, 'select 1 from public.support_conversations where user_id = $1', [w.alice])).toHaveLength(1);
    expect((await conversationOf(w.alice)).support_unread).toBe(2);
  });

  it('ne rattache la conversation qu’à un espace dont la personne est membre', async () => {
    await send(erin, 'Je teste.', w.orgA); // erin n'est membre de rien
    expect((await conversationOf(erin)).org_id).toBeNull();
    await send(w.bob, 'Bonjour de B.', w.orgA); // orgA n'est pas celle de bob
    expect((await conversationOf(w.bob)).org_id).toBeNull();
    await send(w.bob, 'Encore.', w.orgB);
    expect((await conversationOf(w.bob)).org_id).toBe(w.orgB);
  });

  it('nettoie le texte : fins de ligne, caractères de contrôle, marques de direction, espaces de bord', async () => {
    const id = await send(w.carol, '  Bonjour\r\n\r\n\r\n\r\nvoici\u202E txt.exe\u2066 \u0007et\u001B fin  ');
    const [m] = await q<{ body: string }>(db, 'select body from public.support_messages where id = $1', [id]);
    expect(m!.body).toBe('Bonjour\n\nvoici txt.exe et fin');
  });

  it('garde le texte tel quel : HTML et liens ne sont pas interprétés ni modifiés par la base', async () => {
    const id = await send(w.carol, '<script>alert(1)</script> https://exemple.test/?a=1&b=2 😀 مرحبا');
    const [m] = await q<{ body: string }>(db, 'select body from public.support_messages where id = $1', [id]);
    expect(m!.body).toBe('<script>alert(1)</script> https://exemple.test/?a=1&b=2 😀 مرحبا');
  });

  it('refuse un message vide ou fait de blancs, et un message de plus de 2 000 caractères', async () => {
    await expect(send(w.dave, '')).rejects.toThrow(/invalid_message/);
    await expect(send(w.dave, '   \n\t ')).rejects.toThrow(/invalid_message/);
    await expect(send(w.dave, '\u202E\u0007')).rejects.toThrow(/invalid_message/);
    await expect(send(w.dave, 'x'.repeat(2001))).rejects.toThrow(/message_too_long/);
    await expect(send(w.dave, 'x'.repeat(2000))).resolves.toBeTruthy();
    expect(await conversationOf(w.dave)).toMatchObject({ support_unread: 1 }); // les refus n'ont rien laissé
  });

  it('limite le débit : 5 messages par minute, puis il faut attendre', async () => {
    const spammer = await createUser(db, 'spam@e.test');
    for (let i = 0; i < 5; i++) await send(spammer, `message ${i}`);
    await expect(send(spammer, 'message 6')).rejects.toThrow(/rate_limited/);
    expect(await q(db, `select 1 from public.support_messages m join public.support_conversations c on c.id = m.conversation_id where c.user_id = $1`, [spammer])).toHaveLength(5);
    await ageMessages((await conversationOf(spammer)).id);
    await expect(send(spammer, 'une heure plus tard')).resolves.toBeTruthy();
  });

  it('limite à 20 messages sans réponse du support, et la réponse libère la personne', async () => {
    const patient = await createUser(db, 'patient@e.test');
    for (let batch = 0; batch < 4; batch++) {
      for (let i = 0; i < 5; i++) await send(patient, `message ${batch * 5 + i}`);
      await ageMessages((await conversationOf(patient)).id);
    }
    await expect(send(patient, 'le 21e')).rejects.toThrow(/too_many_unanswered/);
    await reply((await conversationOf(patient)).id, 'Bonjour, je regarde.');
    await expect(send(patient, 'merci')).resolves.toBeTruthy();
  });

  it('refuse un compte suspendu, un visiteur anonyme et l’écriture directe dans les tables', async () => {
    await admin(() => q(db, 'select public.admin_suspend_user($1)', [w.dave]));
    await expect(send(w.dave, 'Pourquoi ?')).rejects.toThrow(/account suspended/);
    expect(await as(w.dave, () => q(db, 'select * from public.support_conversations'))).toHaveLength(0); // il ne lit plus rien non plus
    await admin(() => q(db, 'select public.admin_restore_user($1)', [w.dave]));
    await expect(asAnon(db, () => q(db, `select public.support_send('x')`))).rejects.toThrow(/permission denied/);
    await expect(as(erin, () => q(db, `insert into public.support_messages (conversation_id, author, body) select id, 'user', 'x' from public.support_conversations limit 1`))).rejects.toThrow(/permission denied/);
    await expect(as(erin, () => q(db, `update public.support_conversations set user_unread = 0, status = 'resolved'`))).rejects.toThrow(/permission denied/);
    await expect(as(erin, () => q(db, `delete from public.support_messages`))).rejects.toThrow(/permission denied/);
  });
});

describe('qui lit quoi', () => {
  it('chaque personne ne lit que sa conversation et ses messages', async () => {
    const aliceConv = await conversationOf(w.alice);
    const mine = await as(w.alice, () => q<any>(db, 'select id from public.support_conversations'));
    expect(mine.map((c) => c.id)).toEqual([aliceConv.id]);
    const theirs = await as(w.bob, () => q<any>(db, 'select id from public.support_messages where conversation_id = $1', [aliceConv.id]));
    expect(theirs).toEqual([]);
    const aliceMessages = await as(w.alice, () => q<any>(db, 'select body from public.support_messages order by created_at'));
    expect(aliceMessages.map((m) => m.body)).toEqual(['Bonjour, je ne vois pas mon canal Instagram.', 'Un second message.']);
  });

  it('un membre de la même organisation ne voit pas la conversation de son collègue', async () => {
    expect(await as(w.carol, () => q<any>(db, 'select user_id from public.support_conversations'))).toEqual([{ user_id: w.carol }]);
  });

  it('une personne ne voit aucune adresse e-mail : ni dans ses tables, ni dans ce que renvoient ses fonctions', async () => {
    const cols = await q<{ column_name: string }>(db, `select column_name from information_schema.columns where table_schema = 'public' and table_name in ('support_conversations', 'support_messages')`);
    expect(cols.map((c) => c.column_name).filter((n) => /mail/i.test(n))).toEqual([]);
    const seen = JSON.stringify(await as(w.alice, async () => [
      await q(db, 'select * from public.support_conversations'), await q(db, 'select * from public.support_messages'),
    ]));
    for (const email of ['alice@a.test', 'bob@b.test', 'carol@a.test', 'erin@e.test', 'owner@postbiz.test']) expect(seen).not.toContain(email);
  });

  it('les fonctions du propriétaire sont refusées à tout autre, même en appelant l’API directement', async () => {
    const id = (await conversationOf(w.alice)).id;
    for (const sql of [
      'select public.admin_support_summary()', 'select * from public.admin_support_conversations()', `select public.admin_support_thread('${id}')`,
      `select public.admin_support_reply('${id}', 'je suis le support')`, `select public.admin_support_set_status('${id}', 'resolved')`, `select public.admin_support_mark_read('${id}')`,
    ]) {
      await expect(as(w.bob, () => q(db, sql)), sql).rejects.toThrow(/forbidden/);
      await expect(asAnon(db, () => q(db, sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it('le propriétaire n’a pas de droit direct sur les tables : il passe par les fonctions', async () => {
    await expect(admin(() => q(db, 'select * from public.support_messages'))).resolves.toEqual([]); // la RLS ne lui donne que SA conversation (aucune)
    await expect(admin(() => q(db, `update public.support_conversations set status = 'resolved'`))).rejects.toThrow(/permission denied/);
  });
});

describe('espace du propriétaire', () => {
  it('liste les conversations avec l’auteur, son espace, les non-lus et le dernier message', async () => {
    const rows = await list();
    const alice = rows.find((r) => r.email === 'alice@a.test');
    expect(alice).toMatchObject({ user_id: w.alice, org_name: 'Org A', status: 'open', support_unread: 2, user_unread: 0, message_count: 2, last_author: 'user', last_body: 'Un second message.' });
    expect(rows[0]!.total_count).toBe(rows.length);
    const times = rows.map((r) => new Date(r.last_message_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('résume : conversations, ouvertes, résolues, non lues', async () => {
    const s = await summary();
    expect(s).toMatchObject({ all: s.open, resolved: 0 });
    expect(s.unread).toBe(s.all);
    expect(s.unread_messages).toBeGreaterThanOrEqual(s.all);
  });

  it('cherche par e-mail, nom, espace de travail ou texte d’un message, sans prendre % et _ pour des jokers', async () => {
    expect((await list(null, 'ALICE')).map((r) => r.email)).toEqual(['alice@a.test']);
    expect((await list(null, 'org b')).map((r) => r.email)).toEqual(['bob@b.test']);
    expect((await list(null, 'canal instagram')).map((r) => r.email)).toEqual(['alice@a.test']);
    expect(await list(null, '%')).toHaveLength(0);
    expect(await list(null, 'a_a')).toHaveLength(0);
  });

  it('rejette un filtre inconnu', async () => {
    await expect(list('nimportequoi')).rejects.toThrow(/invalid_filter/);
  });

  it('renvoie le fil d’une conversation, du plus ancien au plus récent, avec l’adresse de la personne', async () => {
    const c = await conversationOf(w.alice);
    const t = await thread(c.id);
    expect(t.conversation).toMatchObject({ id: c.id, email: 'alice@a.test', org_name: 'Org A', status: 'open' });
    expect(t.messages.map((m: any) => [m.author, m.body])).toEqual([['user', 'Bonjour, je ne vois pas mon canal Instagram.'], ['user', 'Un second message.']]);
    expect(t.truncated).toBe(false);
    expect(Object.keys(t.messages[0]).sort()).toEqual(['author', 'body', 'created_at', 'id']);
  });

  it('borne le fil aux derniers messages et le signale', async () => {
    const c = await conversationOf(w.alice);
    const t = await thread(c.id, 1);
    expect(t.messages.map((m: any) => m.body)).toEqual(['Un second message.']);
    expect(t.truncated).toBe(true);
  });

  it('renvoie null pour une conversation qui n’existe pas', async () => {
    expect(await thread('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('répondre : le message est ajouté, le compteur du support tombe à zéro, celui de la personne monte', async () => {
    const c = await conversationOf(w.alice);
    await reply(c.id, '  Bonjour Alice, pouvez-vous reconnecter le canal ?  ');
    expect(await conversationOf(w.alice)).toMatchObject({ support_unread: 0, user_unread: 1, last_author: 'support', status: 'open' });
    const mine = await as(w.alice, () => q<any>(db, 'select author, body from public.support_messages order by created_at, id'));
    expect(mine.at(-1)).toEqual({ author: 'support', body: 'Bonjour Alice, pouvez-vous reconnecter le canal ?' });
  });

  it('refuse une réponse vide, trop longue (4 000 caractères au plus) ou adressée à une conversation inconnue', async () => {
    const c = await conversationOf(w.alice);
    await expect(reply(c.id, '  ')).rejects.toThrow(/invalid_message/);
    await expect(reply(c.id, 'x'.repeat(4001))).rejects.toThrow(/message_too_long/);
    await expect(reply(c.id, 'x'.repeat(4000))).resolves.toBeTruthy();
    await expect(reply('00000000-0000-0000-0000-000000000000', 'bonjour')).rejects.toThrow(/not_found/);
  });

  it('marquer lu remet le compteur du support à zéro et lit la notification du propriétaire', async () => {
    const c = await conversationOf(w.bob);
    expect(c.support_unread).toBeGreaterThan(0);
    await admin(() => q(db, 'select public.admin_support_mark_read($1)', [c.id]));
    expect((await conversationOf(w.bob)).support_unread).toBe(0);
    const notifs = await q<any>(db, `select read_at from public.notifications where user_id = $1 and type = 'support_message' and data ->> 'support_conversation_id' = $2`, [owner, c.id]);
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs.every((n) => n.read_at !== null)).toBe(true);
  });

  it('résoudre, rouvrir ; une conversation résolue ne compte plus parmi les ouvertes', async () => {
    const c = await conversationOf(w.carol);
    await admin(() => q(db, `select public.admin_support_set_status($1, 'resolved')`, [c.id]));
    expect(await conversationOf(w.carol)).toMatchObject({ status: 'resolved', support_unread: 0 });
    expect((await conversationOf(w.carol)).resolved_at).not.toBeNull();
    expect((await list('resolved')).map((r) => r.email)).toEqual(['carol@a.test']);
    expect((await list('open')).map((r) => r.email)).not.toContain('carol@a.test');
    expect((await summary()).resolved).toBe(1);
    await admin(() => q(db, `select public.admin_support_set_status($1, 'open')`, [c.id]));
    expect(await conversationOf(w.carol)).toMatchObject({ status: 'open', resolved_at: null });
    await expect(admin(() => q(db, `select public.admin_support_set_status($1, 'closed')`, [c.id]))).rejects.toThrow(/invalid_status/);
    await expect(admin(() => q(db, `select public.admin_support_set_status('00000000-0000-0000-0000-000000000000', 'open')`))).rejects.toThrow(/not_found/);
  });

  it('un nouveau message de la personne rouvre une conversation résolue', async () => {
    const c = await conversationOf(w.carol);
    await admin(() => q(db, `select public.admin_support_set_status($1, 'resolved')`, [c.id]));
    await send(w.carol, 'Finalement, ça ne marche toujours pas.');
    expect(await conversationOf(w.carol)).toMatchObject({ status: 'open', resolved_at: null, support_unread: 1 });
  });

  it('le filtre « non lues » ne garde que les conversations avec des messages à lire', async () => {
    const unread = await list('unread');
    expect(unread.length).toBeGreaterThan(0);
    expect(unread.every((r) => r.support_unread > 0)).toBe(true);
    expect(unread.map((r) => r.email)).not.toContain('bob@b.test'); // lue plus haut
  });

  it('pagine, et total_count reste le nombre de résultats avant la page', async () => {
    const all = await list();
    const page = await list(null, null, 2, 0);
    expect(page).toHaveLength(2);
    expect(page[0]!.total_count).toBe(all.length);
    expect(await list(null, null, 2, all.length)).toHaveLength(0);
  });
});

describe('notifications', () => {
  it('avertit les administrateurs au premier message non lu seulement, sans y mettre l’adresse de la personne', async () => {
    const fresh = await createUser(db, 'fresh@e.test');
    const before = (await q<{ n: number }>(db, `select count(*)::int as n from public.notifications where user_id = $1 and type = 'support_message'`, [owner]))[0]!.n;
    await send(fresh, 'Bonjour, première question.');
    await send(fresh, 'Et une seconde.');
    const rows = await q<any>(db, `select title, body, data from public.notifications where user_id = $1 and type = 'support_message' order by created_at desc`, [owner]);
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ title: 'Nouveau message au support', body: 'Bonjour, première question.', data: { support_conversation_id: (await conversationOf(fresh)).id } });
    expect(JSON.stringify(rows[0])).not.toContain('fresh@e.test');
    // le propriétaire a lu : le message suivant est de nouveau signalé
    const freshId = (await conversationOf(fresh)).id;
    await admin(() => q(db, 'select public.admin_support_mark_read($1)', [freshId]));
    await send(fresh, 'Toujours là ?');
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.notifications where user_id = $1 and type = 'support_message'`, [owner]))[0]!.n).toBe(before + 2);
  });

  it('le propriétaire qui écrit au support ne se notifie pas lui-même', async () => {
    const before = (await q<{ n: number }>(db, `select count(*)::int as n from public.notifications where type = 'support_message'`))[0]!.n;
    await send(owner, 'Test du propriétaire.');
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.notifications where type = 'support_message'`))[0]!.n).toBe(before);
  });

  it('une réponse du support crée une notification pour la personne (relayée en push par send-push)', async () => {
    const c = await conversationOf(w.alice);
    await reply(c.id, 'Voici la réponse.');
    const rows = await as(w.alice, () => q<any>(db, `select type, title, body, data, read_at, org_id from public.notifications where type = 'support_reply' order by created_at desc`));
    expect(rows[0]).toEqual({ type: 'support_reply', title: 'Support Postbiz', body: 'Voici la réponse.', data: { screen: 'support' }, read_at: null, org_id: null });
    expect(JSON.stringify(rows[0])).not.toContain('owner@postbiz.test');
  });

  it('une réponse longue est coupée à 140 caractères dans la notification, entière dans le fil', async () => {
    const c = await conversationOf(w.bob);
    await reply(c.id, 'y'.repeat(900));
    const [n] = await as(w.bob, () => q<{ body: string }>(db, `select body from public.notifications where type = 'support_reply' order by created_at desc limit 1`));
    expect(n!.body).toHaveLength(140);
    const [m] = await as(w.bob, () => q<{ body: string }>(db, `select body from public.support_messages where author = 'support' order by created_at desc limit 1`));
    expect(m!.body).toHaveLength(900);
  });
});

describe('lire les réponses', () => {
  it('support_mark_read remet le compteur à zéro et lit les notifications de réponse, celles de la personne seulement', async () => {
    const c = await conversationOf(w.alice);
    expect(c.user_unread).toBeGreaterThan(0);
    const bobUnread = (await conversationOf(w.bob)).user_unread;
    await as(w.alice, () => q(db, 'select public.support_mark_read()'));
    expect((await conversationOf(w.alice)).user_unread).toBe(0);
    const unreadNotifs = await q<any>(db, `select user_id from public.notifications where type = 'support_reply' and read_at is null`);
    expect(unreadNotifs.map((n) => n.user_id)).not.toContain(w.alice);
    expect((await conversationOf(w.bob)).user_unread).toBe(bobUnread);
  });

  it('refuse un visiteur anonyme', async () => {
    await expect(asAnon(db, () => q(db, 'select public.support_mark_read()'))).rejects.toThrow(/permission denied/);
  });
});

describe('suppressions et temps réel', () => {
  it('supprimer un compte emporte sa conversation et ses messages', async () => {
    const gone = await createUser(db, 'gone@e.test');
    const id = await send(gone, 'Au revoir');
    await q(db, 'delete from auth.users where id = $1', [gone]);
    expect(await q(db, 'select 1 from public.support_conversations where user_id = $1', [gone])).toHaveLength(0);
    expect(await q(db, 'select 1 from public.support_messages where id = $1', [id])).toHaveLength(0);
  });

  it('supprimer l’espace de travail garde la conversation, sans espace', async () => {
    const solo = await createUser(db, 'solo@e.test');
    const org = await as(solo, async () => (await q<{ id: string }>(db, `select public.create_organization('Espace éphémère') as id`))[0]!.id);
    await send(solo, 'Depuis mon espace', org);
    expect((await conversationOf(solo)).org_id).toBe(org);
    await q(db, 'delete from public.organizations where id = $1', [org]);
    expect(await conversationOf(solo)).toMatchObject({ user_id: solo, org_id: null });
  });

  it('les deux tables sont publiées en temps réel (la RLS filtre ce que chacun reçoit)', async () => {
    const rows = await q<{ tablename: string }>(db, `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'support_%'`);
    expect(rows.map((r) => r.tablename).sort()).toEqual(['support_conversations', 'support_messages']);
  });
});

describe('prérequis de la migration', () => {
  it('s’arrête avec un message clair, sans rien créer, si la suspension de comptes n’est pas appliquée', async () => {
    const early = await createDb({ before: '20261027000001_user_suspension.sql' });
    await expect(applyMigration(early, '20261104000001_support_chat.sql')).rejects.toThrow(/Prérequis manquant.*20261027000001_user_suspension/);
    expect(await q(early, `select to_regclass('public.support_conversations') as t`)).toEqual([{ t: null }]);
  });

  it('s’arrête de même si l’espace propriétaire n’est pas appliqué', async () => {
    const early = await createDb({ before: '20261025000001_platform_admin.sql' });
    await expect(applyMigration(early, '20261104000001_support_chat.sql')).rejects.toThrow(/Prérequis manquant.*20261025000001_platform_admin/);
  });
});
