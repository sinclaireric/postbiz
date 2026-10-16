import { MetaOutcomeUnknownError, MetaRejectedError } from '@postbiz/core';
import { describe, expect, it, vi } from 'vitest';
import { processMessage } from '../src/engine/outbox.ts';
import { conversation, fakeDb, integration } from './fakes.ts';

const NOW = new Date('2026-10-16T12:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const msg = { id: 'msg-1', orgId: 'org-1', conversationId: 'conv-1', body: 'Bonjour !', sentBy: 'user-1' };

const send = () => vi.fn(async (_client: unknown, _input: unknown) => ({ messageId: 'mid-1' }));
const reply = () => vi.fn(async () => ({ commentId: 'cid-1' }));

describe('processMessage', () => {
  it('envoie un message privé dans la fenêtre de 24 h et confirme avec l’identifiant du réseau', async () => {
    const db = fakeDb({ getConversation: vi.fn(async () => conversation({ replyWindowExpiresAt: hours(10), lastInboundAt: hours(-14) })) });
    const s = send();
    const out = await processMessage({ db, now: () => NOW, send: s, reply: reply() }, msg);
    expect(out.result).toBe('sent');
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'TOKEN', host: 'graph.facebook.com' }), { senderId: 'PAGE1', recipientId: 'USER1', text: 'Bonjour !', humanAgent: false });
    expect(db.completeMessage).toHaveBeenCalledWith('msg-1', 'mid-1');
  });

  it('refuse hors fenêtre sans tag HUMAN_AGENT, sans appeler Meta', async () => {
    const db = fakeDb({ getConversation: vi.fn(async () => conversation({ replyWindowExpiresAt: hours(-2), lastInboundAt: hours(-26) })) });
    const s = send();
    const out = await processMessage({ db, now: () => NOW, send: s, reply: reply() }, msg);
    expect(out).toMatchObject({ result: 'failed', message: expect.stringMatching(/24 h/) });
    expect(s).not.toHaveBeenCalled();
    expect(db.failMessage).toHaveBeenCalled();
  });

  it('utilise HUMAN_AGENT hors fenêtre quand le canal y est autorisé et que le dernier message a moins de 7 jours', async () => {
    const db = fakeDb({
      getIntegration: vi.fn(async () => integration({ settings: { human_agent_enabled: true } })),
      getConversation: vi.fn(async () => conversation({ replyWindowExpiresAt: hours(-2), lastInboundAt: hours(-26) })),
    });
    const s = send();
    const out = await processMessage({ db, now: () => NOW, send: s, reply: reply() }, msg);
    expect(out.result).toBe('sent');
    expect(s.mock.calls[0]![1]).toMatchObject({ humanAgent: true });
  });

  it('refuse HUMAN_AGENT au-delà de 7 jours', async () => {
    const db = fakeDb({
      getIntegration: vi.fn(async () => integration({ settings: { human_agent_enabled: true } })),
      getConversation: vi.fn(async () => conversation({ replyWindowExpiresAt: hours(-24 * 8), lastInboundAt: hours(-24 * 9) })),
    });
    const s = send();
    expect((await processMessage({ db, now: () => NOW, send: s, reply: reply() }, msg)).result).toBe('failed');
    expect(s).not.toHaveBeenCalled();
  });

  it('répond à un commentaire sous le commentaire racine, sans fenêtre', async () => {
    const db = fakeDb({ getConversation: vi.fn(async () => conversation({ kind: 'comment_thread', externalId: 'COMMENT1', replyWindowExpiresAt: null })) });
    const r = reply();
    const out = await processMessage({ db, now: () => NOW, send: send(), reply: r }, msg);
    expect(out.result).toBe('sent');
    expect(r).toHaveBeenCalledWith(expect.anything(), 'facebook', 'COMMENT1', 'Bonjour !');
    expect(db.completeMessage).toHaveBeenCalledWith('msg-1', 'cid-1');
  });

  it('utilise l’hôte et l’expéditeur configurés pour Instagram', async () => {
    const db = fakeDb({
      getIntegration: vi.fn(async () => integration({ provider: 'instagram', internalId: 'IG1', settings: { graph_host: 'graph.instagram.com', messaging_sender_id: 'IGSENDER' } })),
      getConversation: vi.fn(async () => conversation({ replyWindowExpiresAt: hours(5) })),
    });
    const s = send();
    await processMessage({ db, now: () => NOW, send: s, reply: reply() }, msg);
    expect(s.mock.calls[0]![0]).toMatchObject({ host: 'graph.instagram.com' });
    expect(s.mock.calls[0]![1]).toMatchObject({ senderId: 'IGSENDER' });
  });

  it('un jeton refusé par Meta marque le canal « à reconnecter »', async () => {
    const db = fakeDb({ getConversation: vi.fn(async () => conversation({ replyWindowExpiresAt: hours(5) })) });
    const s = vi.fn(async () => { throw new MetaRejectedError(400, 190, 'Invalid OAuth access token', true); });
    const out = await processMessage({ db, now: () => NOW, send: s as any, reply: reply() }, msg);
    expect(out.result).toBe('failed');
    expect(db.markIntegrationRefreshNeeded).toHaveBeenCalledWith('int-1');
  });

  it('une issue inconnue donne « failed » avec un message explicite, sans renvoi', async () => {
    const db = fakeDb({ getConversation: vi.fn(async () => conversation({ replyWindowExpiresAt: hours(5) })) });
    const s = vi.fn(async () => { throw new MetaOutcomeUnknownError('Meta a répondu 503'); });
    const out = await processMessage({ db, now: () => NOW, send: s as any, reply: reply() }, msg);
    expect(out).toMatchObject({ result: 'failed', message: expect.stringMatching(/Résultat inconnu/) });
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('refuse un message vide et un réseau non géré', async () => {
    const db = fakeDb();
    expect((await processMessage({ db, now: () => NOW }, { ...msg, body: '  ' })).result).toBe('failed');
    const x = fakeDb({ getIntegration: vi.fn(async () => integration({ provider: 'x' })) });
    expect(await processMessage({ db: x, now: () => NOW }, msg)).toMatchObject({ result: 'failed', message: expect.stringMatching(/pas encore disponible/) });
  });
});
