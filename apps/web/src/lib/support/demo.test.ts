import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_CONTEXT } from '@/lib/data/demo';
import { markSupportRead, loadSupportThread, loadSupportUnread, sendSupportMessage } from './data';
import {
  demoAdminMarkRead, demoAdminReply, demoAdminSetStatus, demoAdminThread, demoList, demoMarkRead, demoSend, demoSummary, demoThread, demoUnread, resetDemoSupport,
} from './demo';
import { SUPPORT_MAX_UNANSWERED, SUPPORT_REPLY_MAX, SUPPORT_USER_MAX } from './logic';

const NOW = Date.parse('2026-11-04T10:00:00Z');
const me = { id: 'demo-user', name: 'Camille', email: 'camille@maison-lune.example' };
const send = (body: string, now = NOW) => demoSend(me, 'Maison Lune', body, now);

beforeEach(() => resetDemoSupport(NOW));

describe('chat de support en mode démo', () => {
  it('part de trois conversations d’exemple pour l’espace propriétaire, et d’aucune pour la personne connectée', () => {
    expect(demoSummary()).toEqual({ all: 3, open: 2, resolved: 1, unread: 1, unreadMessages: 2 });
    expect(demoThread(me.id)).toEqual({ conversationId: null, status: 'open', unread: 0, messages: [] });
    expect(demoUnread(me.id)).toBe(0);
  });

  it('le premier message crée la conversation, qui apparaît chez le propriétaire avec l’adresse et l’espace de la personne', () => {
    expect(send('  Bonjour,\r\n\r\n\r\n\r\nje voudrais de l’aide.  ')).toEqual({ ok: true });
    const t = demoThread(me.id);
    expect(t.conversationId).toBeTruthy();
    expect(t.messages.map((m) => [m.author, m.body])).toEqual([['user', 'Bonjour,\n\nje voudrais de l’aide.']]);
    const { rows, total } = demoList('all', '', 1);
    expect(total).toBe(4);
    expect(rows.find((r) => r.userId === me.id)).toMatchObject({ email: me.email, orgName: 'Maison Lune', supportUnread: 1, lastAuthor: 'user', status: 'open', messageCount: 1 });
  });

  it('la réponse du propriétaire arrive dans le fil de la personne, avec un compteur de non-lus qui retombe quand elle les lit', () => {
    send('Bonjour');
    const id = demoThread(me.id).conversationId!;
    expect(demoAdminReply(id, 'Bonjour Camille !', NOW + 5_000)).toEqual({ ok: true });
    expect(demoUnread(me.id)).toBe(1);
    expect(demoThread(me.id).messages.at(-1)).toMatchObject({ author: 'support', body: 'Bonjour Camille !' });
    expect(demoAdminThread(id)?.conversation).toMatchObject({ supportUnread: 0, userUnread: 1 });
    demoMarkRead(me.id);
    expect(demoUnread(me.id)).toBe(0);
  });

  it('résoudre, puis un nouveau message de la personne rouvre la conversation', () => {
    send('Bonjour');
    const id = demoThread(me.id).conversationId!;
    expect(demoAdminSetStatus(id, 'resolved', NOW + 1_000)).toBe(true);
    expect(demoThread(me.id).status).toBe('resolved');
    expect(demoList('resolved', '', 1).rows.map((r) => r.userId)).toContain(me.id);
    send('Finalement non', NOW + 120_000);
    expect(demoThread(me.id).status).toBe('open');
    expect(demoAdminThread(id)?.conversation.resolvedAt).toBeNull();
    expect(demoAdminSetStatus('inconnu', 'open')).toBe(false);
  });

  it('applique les limites de la base : message vide, trop long, 5 par minute, 20 sans réponse', () => {
    expect(send('   ')).toEqual({ ok: false, code: 'invalid_message' });
    expect(send('x'.repeat(SUPPORT_USER_MAX + 1))).toEqual({ ok: false, code: 'message_too_long' });
    for (let i = 0; i < 5; i++) expect(send(`m${i}`, NOW + i * 1000)).toEqual({ ok: true });
    expect(send('m5', NOW + 10_000)).toEqual({ ok: false, code: 'rate_limited' });
    // espacés d'une minute chacun : seule la limite des messages sans réponse joue
    for (let i = 5; i < SUPPORT_MAX_UNANSWERED; i++) expect(send(`m${i}`, NOW + 120_000 + i * 61_000)).toEqual({ ok: true });
    expect(send('de trop', NOW + 120_000 + 30 * 61_000)).toEqual({ ok: false, code: 'too_many_unanswered' });
    const id = demoThread(me.id).conversationId!;
    demoAdminReply(id, 'Je regarde.', NOW + 120_000 + 31 * 61_000);
    expect(send('merci', NOW + 120_000 + 32 * 61_000)).toEqual({ ok: true });
  });

  it('limite les réponses du propriétaire à 4 000 caractères et refuse une conversation inconnue', () => {
    const id = '00000000-0000-4000-a000-000000000101';
    expect(demoAdminReply(id, ' ')).toEqual({ ok: false, code: 'invalid_message' });
    expect(demoAdminReply(id, 'x'.repeat(SUPPORT_REPLY_MAX + 1))).toEqual({ ok: false, code: 'message_too_long' });
    expect(demoAdminReply('00000000-0000-4000-a000-0000000009ff', 'Bonjour')).toEqual({ ok: false, code: 'not_found' });
  });

  it('marque lue une conversation du propriétaire', () => {
    expect(demoSummary().unread).toBe(1);
    demoAdminMarkRead('00000000-0000-4000-a000-000000000101');
    expect(demoSummary()).toMatchObject({ unread: 0, unreadMessages: 0 });
  });

  it('filtre, cherche (adresse, nom, espace, texte d’un message) et pagine comme la base', () => {
    expect(demoList('unread', '', 1).rows.map((r) => r.name)).toEqual(['Léa Martin']);
    expect(demoList('resolved', '', 1).rows.map((r) => r.name)).toEqual(['Inès Dubois']);
    expect(demoList('open', '', 1).total).toBe(2);
    expect(demoList('all', 'MAISON verte', 1).rows.map((r) => r.name)).toEqual(['Hugo Bernard']);
    expect(demoList('all', 'shorts', 1).rows.map((r) => r.name)).toEqual(['Hugo Bernard']);
    expect(demoList('all', 'introuvable', 1)).toEqual({ rows: [], total: 0 });
    const all = demoList('all', '', 1).rows;
    expect(all.map((r) => r.lastMessageAt)).toEqual([...all.map((r) => r.lastMessageAt)].sort().reverse());
    expect(demoList('all', '', 2)).toEqual({ rows: [], total: 3 });
  });

  it('ne renvoie jamais une référence vers le magasin : modifier un fil lu ne change pas la démo', () => {
    send('Bonjour');
    const t = demoThread(me.id);
    t.messages[0]!.body = 'modifié';
    expect(demoThread(me.id).messages[0]!.body).toBe('Bonjour');
    const a = demoAdminThread(t.conversationId!)!;
    a.messages.length = 0;
    expect(demoAdminThread(t.conversationId!)!.messages).toHaveLength(1);
  });
});

describe('lib/support/data en mode démo', () => {
  it('envoie un message et rend le fil à jour, ou le code de l’erreur', async () => {
    const ok = await sendSupportMessage(DEMO_CONTEXT, 'Bonjour le support');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.thread.messages.map((m) => m.body)).toEqual(['Bonjour le support']);
    expect(await sendSupportMessage(DEMO_CONTEXT, '  ')).toEqual({ ok: false, code: 'invalid_message' });
    expect(await sendSupportMessage(DEMO_CONTEXT, 'x'.repeat(SUPPORT_USER_MAX + 1))).toEqual({ ok: false, code: 'message_too_long' });
  });

  it('rend le fil, le nombre de réponses non lues, et marque les réponses lues', async () => {
    await sendSupportMessage(DEMO_CONTEXT, 'Bonjour');
    const id = (await loadSupportThread(DEMO_CONTEXT)).conversationId!;
    demoAdminReply(id, 'Réponse');
    expect(await loadSupportUnread(DEMO_CONTEXT)).toBe(1);
    await markSupportRead(DEMO_CONTEXT);
    expect(await loadSupportUnread(DEMO_CONTEXT)).toBe(0);
    expect((await loadSupportThread(DEMO_CONTEXT)).messages).toHaveLength(2);
  });

  it('le rate limit joue aussi par cette voie, et rend le fil avec le refus', async () => {
    for (let i = 0; i < 5; i++) await sendSupportMessage(DEMO_CONTEXT, `m${i}`);
    const refused = await sendSupportMessage(DEMO_CONTEXT, 'trop vite');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('rate_limited');
      expect(refused.thread?.messages).toHaveLength(5);
    }
  });
});
