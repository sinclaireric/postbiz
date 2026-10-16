import { describe, expect, it, vi } from 'vitest';
import {
  MetaOutcomeUnknownError, MetaRejectedError, replyToComment, sendDirectMessage, type FetchLike,
} from '../src/index.ts';

const respond = (status: number, body: unknown): FetchLike =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }));

describe('sendDirectMessage', () => {
  it('envoie un message dans la fenêtre standard', async () => {
    const f = respond(200, { recipient_id: 'U1', message_id: 'm_1' });
    const r = await sendDirectMessage({ accessToken: 'TOK', fetch: f }, { senderId: 'PAGE1', recipientId: 'U1', text: 'Bonjour' });
    expect(r).toEqual({ messageId: 'm_1' });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/PAGE1/messages');
    expect(init.headers.Authorization).toBe('Bearer TOK');
    expect(JSON.parse(init.body)).toEqual({ recipient: { id: 'U1' }, messaging_type: 'RESPONSE', message: { text: 'Bonjour' } });
  });

  it('utilise le tag HUMAN_AGENT hors fenêtre', async () => {
    const f = respond(200, { message_id: 'm_2' });
    await sendDirectMessage({ accessToken: 'T', fetch: f }, { senderId: 'P', recipientId: 'U', text: 'x', humanAgent: true });
    expect(JSON.parse((f as any).mock.calls[0][1].body)).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  });

  it('peut cibler graph.instagram.com', async () => {
    const f = respond(200, { message_id: 'm_3' });
    await sendDirectMessage({ accessToken: 'T', host: 'graph.instagram.com', fetch: f }, { senderId: 'IG1', recipientId: 'U', text: 'x' });
    expect((f as any).mock.calls[0][0]).toBe('https://graph.instagram.com/v23.0/IG1/messages');
  });

  it('un refus 4xx est une erreur « rejetée » (rien n’est parti)', async () => {
    const f = respond(400, { error: { code: 10, message: 'Hors de la fenêtre de 24 h' } });
    await expect(sendDirectMessage({ accessToken: 'T', fetch: f }, { senderId: 'P', recipientId: 'U', text: 'x' }))
      .rejects.toMatchObject({ name: 'MetaRejectedError', code: 10, needsReconnect: false });
  });

  it('un jeton expiré (code 190) demande une reconnexion', async () => {
    const f = respond(400, { error: { code: 190, message: 'Invalid OAuth access token' } });
    const err = await sendDirectMessage({ accessToken: 'T', fetch: f }, { senderId: 'P', recipientId: 'U', text: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaRejectedError);
    expect(err.needsReconnect).toBe(true);
  });

  it('un 5xx ou une coupure réseau donne un résultat « inconnu » (jamais rejoué automatiquement)', async () => {
    await expect(sendDirectMessage({ accessToken: 'T', fetch: respond(503, {}) }, { senderId: 'P', recipientId: 'U', text: 'x' }))
      .rejects.toBeInstanceOf(MetaOutcomeUnknownError);
    const boom: FetchLike = async () => { throw new Error('ECONNRESET'); };
    await expect(sendDirectMessage({ accessToken: 'T', fetch: boom }, { senderId: 'P', recipientId: 'U', text: 'x' }))
      .rejects.toBeInstanceOf(MetaOutcomeUnknownError);
  });

  it('une réponse 200 sans identifiant est traitée comme inconnue', async () => {
    await expect(sendDirectMessage({ accessToken: 'T', fetch: respond(200, {}) }, { senderId: 'P', recipientId: 'U', text: 'x' }))
      .rejects.toBeInstanceOf(MetaOutcomeUnknownError);
  });
});

describe('replyToComment', () => {
  it('Facebook : /comments', async () => {
    const f = respond(200, { id: 'C9' });
    expect(await replyToComment({ accessToken: 'T', fetch: f }, 'facebook', 'C1', 'Merci')).toEqual({ commentId: 'C9' });
    expect((f as any).mock.calls[0][0]).toBe('https://graph.facebook.com/v23.0/C1/comments');
    expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({ message: 'Merci' });
  });

  it('Instagram : /replies', async () => {
    const f = respond(200, { id: 'C10' });
    await replyToComment({ accessToken: 'T', fetch: f }, 'instagram', 'IGC1', 'Merci');
    expect((f as any).mock.calls[0][0]).toBe('https://graph.facebook.com/v23.0/IGC1/replies');
  });
});
