import { describe, expect, it, vi } from 'vitest';
import {
  buildExpoMessages,
  chunk,
  contentForInboundMessage,
  contentForNotification,
  handlePushWebhook,
  isExpoPushToken,
  messageRecipients,
  sendExpoMessages,
  truncate,
  type ConversationContext,
  type ExpoMessage,
  type PushDb,
  type SendDeps,
} from '../src/index.ts';

const tok = (n: number | string) => `ExponentPushToken[${n}]`;
const conv: ConversationContext = { id: 'conv-1', orgId: 'org-1', kind: 'dm', contactName: 'Léa Martin', contactUsername: 'lea' };

describe('format — jetons et lots', () => {
  it('reconnaît les jetons Expo et rejette le reste', () => {
    expect(isExpoPushToken('ExponentPushToken[abc-123_X]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true);
    for (const bad of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'https://fcm.example/1', null, 42]) expect(isExpoPushToken(bad)).toBe(false);
  });

  it('découpe en lots sans perdre d’élément', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
    expect(chunk(Array.from({ length: 250 }, (_, i) => i), 100).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(() => chunk([1], 0)).toThrow();
  });

  it('tronque en repliant les espaces', () => {
    expect(truncate('  a \n\n b  ', 10)).toBe('a b');
    const t = truncate('x'.repeat(200), 20);
    expect(t).toHaveLength(20);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('format — notifications du worker', () => {
  it('normalise conversationId (camelCase du worker) en conversation_id', () => {
    const c = contentForNotification({ id: 'n1', type: 'message_failed', title: 'Réponse non envoyée', body: 'Fenêtre de 24 h dépassée', org_id: 'o1', data: { conversationId: 'conv-9' } })!;
    expect(c.data).toMatchObject({ conversation_id: 'conv-9', notification_id: 'n1', type: 'message_failed', org_id: 'o1' });
    expect(c.data).not.toHaveProperty('conversationId');
    expect(c.title).toBe('Réponse non envoyée');
  });

  it('garde conversation_id tel quel et ignore les valeurs non scalaires', () => {
    const c = contentForNotification({ title: 'T', data: { conversation_id: 'c2', nested: { a: 1 }, list: [1], postId: 'p1' } })!;
    expect(c.data).toEqual({ conversation_id: 'c2', postId: 'p1' });
  });

  it('sans conversation, la charge n’a pas de conversation_id (l’app ouvre /notifications)', () => {
    const c = contentForNotification({ title: 'Canal à reconnecter', body: 'x', type: 'channel_reconnect', data: { integrationId: 'i1' } })!;
    expect(c.data).not.toHaveProperty('conversation_id');
    expect(c.data.integrationId).toBe('i1');
  });

  it('tolère data null / tableau et refuse une notification sans titre', () => {
    expect(contentForNotification({ title: 'T', data: null })!.data).toEqual({});
    expect(contentForNotification({ title: 'T', data: [1, 2] })!.data).toEqual({});
    expect(contentForNotification({ title: '  ', body: 'x' })).toBeNull();
    expect(contentForNotification({ body: 'x' })).toBeNull();
  });

  it('réduit une charge trop volumineuse à ce qu’il faut pour router', () => {
    const c = contentForNotification({ title: 'T', data: { conversationId: 'c3', blob: 'x'.repeat(5000) } })!;
    expect(c.data).toEqual({ conversation_id: 'c3' });
  });
});

describe('format — messages entrants', () => {
  it('message privé : titre = contact, corps = aperçu, data.conversation_id', () => {
    const c = contentForInboundMessage({ id: 'm1', body: 'Bonjour,\n\n   avez-vous   ce modèle en bleu ?' }, conv);
    expect(c).toEqual({
      title: 'Léa Martin',
      body: 'Bonjour, avez-vous ce modèle en bleu ?',
      data: { type: 'inbox_message', conversation_id: 'conv-1', org_id: 'org-1', message_id: 'm1' },
    });
  });

  it('commentaire, contact sans nom, pièce jointe seule', () => {
    expect(contentForInboundMessage({ body: 'top !' }, { ...conv, kind: 'comment_thread' }).title).toBe('Léa Martin a commenté');
    expect(contentForInboundMessage({ body: 'x' }, { ...conv, contactName: null, contactUsername: '@lea_m' }).title).toBe('@lea_m');
    expect(contentForInboundMessage({ body: 'x' }, { ...conv, contactName: null, contactUsername: null }).title).toBe('Nouveau message');
    expect(contentForInboundMessage({ body: 'x' }, { ...conv, kind: 'comment_thread', contactName: null, contactUsername: null }).title).toBe('Nouveau commentaire');
    expect(contentForInboundMessage({ body: '', has_attachments: true }, conv).body).toBe('Pièce jointe');
    expect(contentForInboundMessage({ body: null, attachments: [{ type: 'image' }] }, conv).body).toBe('Pièce jointe');
    expect(contentForInboundMessage({ body: null }, conv).body).toBe('Nouveau message');
  });

  it('tronque les longs messages', () => {
    expect(contentForInboundMessage({ body: 'a'.repeat(500) }, conv).body.length).toBeLessThanOrEqual(140);
  });

  it('destinataires : l’assigné seul s’il peut répondre, sinon tous les agents, sans doublon', () => {
    expect(messageRecipients('u2', ['u1', 'u2', 'u3'])).toEqual(['u2']);
    expect(messageRecipients(null, ['u1', 'u2', 'u1'])).toEqual(['u1', 'u2']);
    expect(messageRecipients('viewer', ['u1', 'u2'])).toEqual(['u1', 'u2']); // assigné devenu lecteur / parti
    expect(messageRecipients('u1', [])).toEqual([]);
  });
});

describe('buildExpoMessages', () => {
  const content = { title: 'T', body: 'B', data: { conversation_id: 'c' } };
  it('un message par jeton valide, sans doublon ni jeton web', () => {
    const msgs = buildExpoMessages(content, [
      { userId: 'a', token: tok(1) },
      { userId: 'b', token: tok(1) },
      { userId: 'a', token: tok(2) },
      { userId: 'a', token: 'web-endpoint' },
    ]);
    expect(msgs.map((m) => m.to)).toEqual([tok(1), tok(2)]);
    expect(msgs[0]).toMatchObject({ title: 'T', body: 'B', data: { conversation_id: 'c' }, channelId: 'default', priority: 'high', sound: 'default' });
  });
});

// ---------------------------------------------------------------- envoi

const msgs = (n: number): ExpoMessage[] => buildExpoMessages({ title: 'T', body: 'B', data: {} }, Array.from({ length: n }, (_, i) => ({ userId: 'u', token: tok(i) })));
const ok = (n: number) => Array.from({ length: n }, (_, i) => ({ status: 'ok', id: `t${i}` }));
const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function deps(fetchImpl: (...a: any[]) => Promise<Response>, extra: Partial<SendDeps> = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const f = vi.fn(fetchImpl);
  return { d: { fetch: f as unknown as typeof fetch, sleep, ...extra } satisfies SendDeps, f, sleep };
}
const sentBody = (f: { mock: { calls: any[][] } }, call = 0) => JSON.parse((f.mock.calls[call]![1] as RequestInit).body as string) as ExpoMessage[];

describe('sendExpoMessages', () => {
  it('envoie par lots de 100 vers l’API Expo et compte les tickets ok', async () => {
    const { d, f } = deps(async (_u, init) => res(200, { data: ok(JSON.parse(init.body).length) }));
    const r = await sendExpoMessages(msgs(250), d);
    expect(r).toEqual({ sent: 250, deadTokens: [], failed: [] });
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[0]![0]).toBe('https://exp.host/--/api/v2/push/send');
    expect([0, 1, 2].map((i) => sentBody(f, i).length)).toEqual([100, 100, 50]);
  });

  it('n’envoie rien (aucun appel réseau) sans message', async () => {
    const { d, f } = deps(async () => res(200, { data: [] }));
    expect(await sendExpoMessages([], d)).toEqual({ sent: 0, deadTokens: [], failed: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it('DeviceNotRegistered => jeton à supprimer ; autre erreur => échec sans suppression', async () => {
    const { d } = deps(async () =>
      res(200, {
        data: [
          { status: 'ok', id: 'a' },
          { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
          { status: 'error', message: 'oups' },
        ],
      })
    );
    const r = await sendExpoMessages(msgs(4), d);
    expect(r.sent).toBe(1);
    expect(r.deadTokens).toEqual([tok(1)]);
    expect(r.failed).toEqual([
      { token: tok(2), reason: 'MessageTooBig' },
      { token: tok(3), reason: 'oups' },
    ]);
  });

  it('un ticket manquant n’entraîne jamais la suppression du jeton', async () => {
    const { d } = deps(async () => res(200, { data: ok(1) }));
    const r = await sendExpoMessages(msgs(2), d);
    expect(r.deadTokens).toEqual([]);
    expect(r.failed).toEqual([{ token: tok(1), reason: 'ticket manquant' }]);
  });

  it('429 / 5xx / coupure réseau : nouvelles tentatives avec attente doublée, puis succès', async () => {
    let n = 0;
    const { d, f, sleep } = deps(async () => {
      n++;
      if (n === 1) return res(429, { errors: [{ code: 'TOO_MANY_REQUESTS' }] });
      if (n === 2) throw new Error('ECONNRESET');
      return res(200, { data: ok(1) });
    });
    const r = await sendExpoMessages(msgs(1), d);
    expect(r.sent).toBe(1);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it('abandonne un lot après 3 tentatives sans bloquer les lots suivants ni lever', async () => {
    let call = 0;
    const { d, f } = deps(async (_u, init) => {
      call++;
      if (call <= 3) return res(503, 'unavailable'); // 1er lot : 3 échecs
      return res(200, { data: ok(JSON.parse(init.body).length) });
    });
    const r = await sendExpoMessages(msgs(150), d);
    expect(f).toHaveBeenCalledTimes(4);
    expect(r.sent).toBe(50);
    expect(r.failed).toHaveLength(100);
    expect(r.failed[0]!.reason).toContain('HTTP 503');
    expect(r.deadTokens).toEqual([]);
  });

  it('une erreur 4xx n’est pas rejouée', async () => {
    const { d, f, sleep } = deps(async () => res(400, { errors: [{ code: 'VALIDATION_ERROR' }] }));
    const r = await sendExpoMessages(msgs(1), d);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(r.failed[0]!.reason).toContain('HTTP 400');
  });

  it('réponse illisible ou inattendue : échec du lot, pas de suppression', async () => {
    const bad = deps(async () => res(200, 'pas du json'), { maxAttempts: 1 });
    expect((await sendExpoMessages(msgs(1), bad.d)).failed).toHaveLength(1);
    const odd = deps(async () => res(200, { data: { status: 'ok' } }));
    const r = await sendExpoMessages(msgs(1), odd.d);
    expect(r.failed).toHaveLength(1);
    expect(r.deadTokens).toEqual([]);
  });

  it('ajoute le jeton d’accès Expo s’il est configuré', async () => {
    const a = deps(async () => res(200, { data: ok(1) }), { accessToken: 'sekret' });
    await sendExpoMessages(msgs(1), a.d);
    expect((a.f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sekret' });
    const b = deps(async () => res(200, { data: ok(1) }));
    await sendExpoMessages(msgs(1), b.d);
    expect((b.f.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });
});

// ---------------------------------------------------------------- webhook

function fakeDb(over: Partial<PushDb> = {}) {
  const deleted: string[][] = [];
  const db: PushDb = {
    getConversation: vi.fn(async (id) => (id === 'conv-1' ? { ...conv, assigneeId: null } : null)),
    listResponderIds: vi.fn(async () => ['u1', 'u2']),
    getTokens: vi.fn(async (ids: string[]) => ids.map((u, i) => ({ userId: u, token: tok(`${u}-${i}`) }))),
    deleteTokens: vi.fn(async (t) => { deleted.push(t); }),
    ...over,
  };
  return { db, deleted };
}
const cfg = { webhookSecret: 'shh' };
const req = (body: unknown, headers: Record<string, string> = { 'x-push-secret': 'shh' }, method = 'POST') =>
  new Request('https://x.test/send-push', { method, body: method === 'POST' ? JSON.stringify(body) : undefined, headers });
const insert = (table: string, record: unknown) => ({ type: 'INSERT', schema: 'public', table, record, old_record: null });
const sendOk = () => deps(async (_u, init) => res(200, { data: ok(JSON.parse(init.body).length) }));

describe('handlePushWebhook', () => {
  it('refuse sans secret, avec un mauvais secret, ou si le secret n’est pas configuré', async () => {
    const { db } = fakeDb();
    const s = sendOk();
    expect((await handlePushWebhook(req({}, {}), cfg, db, s.d)).status).toBe(401);
    expect((await handlePushWebhook(req({}, { 'x-push-secret': 'nope' }), cfg, db, s.d)).status).toBe(401);
    expect((await handlePushWebhook(req({}, { 'x-push-secret': '' }), { webhookSecret: '' }, db, s.d)).status).toBe(401);
    expect(s.f).not.toHaveBeenCalled();
    expect(db.getTokens).not.toHaveBeenCalled();
  });

  it('405 hors POST, 400 si le corps n’est pas du JSON', async () => {
    const { db } = fakeDb();
    const s = sendOk();
    expect((await handlePushWebhook(req(null, { 'x-push-secret': 'shh' }, 'GET'), cfg, db, s.d)).status).toBe(405);
    const bad = new Request('https://x.test/', { method: 'POST', body: '{nope', headers: { 'x-push-secret': 'shh' } });
    expect((await handlePushWebhook(bad, cfg, db, s.d)).status).toBe(400);
  });

  it('notification : push vers les jetons de son destinataire, avec conversation_id', async () => {
    const { db } = fakeDb();
    const s = sendOk();
    const r = await handlePushWebhook(
      req(insert('notifications', { id: 'n1', user_id: 'u1', org_id: 'o1', type: 'message_failed', title: 'Réponse non envoyée', body: 'Erreur', data: { conversationId: 'conv-1' } })),
      cfg, db, s.d
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'sent', sent: 1, removed: 0, failed: 0 });
    expect(db.getTokens).toHaveBeenCalledWith(['u1']);
    expect(sentBody(s.f)[0]).toMatchObject({ title: 'Réponse non envoyée', data: { conversation_id: 'conv-1', notification_id: 'n1' } });
  });

  it('message entrant non assigné : tous les agents ; assigné : lui seul', async () => {
    const a = fakeDb();
    const s1 = sendOk();
    const body = insert('messages', { id: 'm1', conversation_id: 'conv-1', org_id: 'org-1', direction: 'in', body: 'Salut' });
    await handlePushWebhook(req(body), cfg, a.db, s1.d);
    expect(a.db.getTokens).toHaveBeenCalledWith(['u1', 'u2']);
    expect(sentBody(s1.f)).toHaveLength(2);
    expect(sentBody(s1.f)[0]).toMatchObject({ title: 'Léa Martin', body: 'Salut', data: { conversation_id: 'conv-1', message_id: 'm1' } });

    const b = fakeDb({ getConversation: vi.fn(async () => ({ ...conv, assigneeId: 'u2' })) });
    await handlePushWebhook(req(body), cfg, b.db, sendOk().d);
    expect(b.db.getTokens).toHaveBeenCalledWith(['u2']);
  });

  it('ignore les messages sortants, les autres tables et événements, sans interroger la base', async () => {
    const { db } = fakeDb();
    const s = sendOk();
    for (const ev of [
      insert('messages', { conversation_id: 'conv-1', direction: 'out' }),
      insert('posts', { id: 'p' }),
      { ...insert('notifications', { user_id: 'u1', title: 'T' }), type: 'UPDATE' },
      insert('notifications', { user_id: 'u1' }), // pas de titre
      insert('messages', { conversation_id: 'inconnue', direction: 'in' }),
      { foo: 1 },
    ]) {
      const r = await handlePushWebhook(req(ev), cfg, db, s.d);
      expect(r.status).toBe(200);
      expect(((await r.json()) as any).status).toBe('ignored');
    }
    expect(s.f).not.toHaveBeenCalled();
  });

  it('sans jeton enregistré : rien n’est envoyé', async () => {
    const { db } = fakeDb({ getTokens: vi.fn(async () => []) });
    const s = sendOk();
    const r = await handlePushWebhook(req(insert('notifications', { user_id: 'u1', title: 'T' })), cfg, db, s.d);
    expect(((await r.json()) as any).reason).toBe('aucun jeton enregistré');
    expect(s.f).not.toHaveBeenCalled();
  });

  it('supprime les jetons DeviceNotRegistered', async () => {
    const { db, deleted } = fakeDb({ getTokens: vi.fn(async () => [{ userId: 'u1', token: tok('live') }, { userId: 'u1', token: tok('dead') }]) });
    const s = deps(async () => res(200, { data: [{ status: 'ok', id: '1' }, { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }] }));
    const r = await handlePushWebhook(req(insert('notifications', { user_id: 'u1', title: 'T' })), cfg, db, s.d);
    expect(await r.json()).toMatchObject({ sent: 1, removed: 1 });
    expect(deleted).toEqual([[tok('dead')]]);
  });

  it('502 si Expo est injoignable (aucun envoi), jetons conservés ; 500 si la base échoue', async () => {
    const { db, deleted } = fakeDb();
    const down = deps(async () => res(503, 'down'), { maxAttempts: 2 });
    const r = await handlePushWebhook(req(insert('notifications', { user_id: 'u1', title: 'T' })), cfg, db, down.d);
    expect(r.status).toBe(502);
    expect(deleted).toEqual([]);

    const broken = fakeDb({ getTokens: vi.fn(async () => { throw new Error('db down'); }) });
    const r2 = await handlePushWebhook(req(insert('notifications', { user_id: 'u1', title: 'T' })), cfg, broken.db, sendOk().d);
    expect(r2.status).toBe(500);
  });
});
