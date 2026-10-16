import { describe, expect, it } from 'vitest';
import { normalizeMetaWebhook } from '../src/index.ts';

describe('normalizeMetaWebhook — messages privés', () => {
  it('Messenger : message entrant', () => {
    const events = normalizeMetaWebhook({
      object: 'page',
      entry: [{
        id: 'PAGE1', time: 1760000000000,
        messaging: [{
          sender: { id: 'USER1' }, recipient: { id: 'PAGE1' }, timestamp: 1760000000123,
          message: { mid: 'm_abc', text: 'Bonjour, quel est le prix ?' },
        }],
      }],
    });
    expect(events).toEqual([{
      provider: 'facebook', accountId: 'PAGE1', kind: 'dm',
      conversationExternalId: 'PAGE1:USER1', contact: { id: 'USER1' },
      messageExternalId: 'm_abc', direction: 'in', body: 'Bonjour, quel est le prix ?',
      attachments: [], sentAt: new Date(1760000000123).toISOString(),
    }]);
  });

  it('écho d’un message envoyé par la Page : sens sortant, contact = destinataire', () => {
    const [e] = normalizeMetaWebhook({
      object: 'page',
      entry: [{ id: 'PAGE1', messaging: [{
        sender: { id: 'PAGE1' }, recipient: { id: 'USER1' }, timestamp: 1760000000000,
        message: { mid: 'm_out', text: 'Merci !', is_echo: true },
      }] }],
    });
    expect(e).toMatchObject({ direction: 'out', contact: { id: 'USER1' }, conversationExternalId: 'PAGE1:USER1' });
  });

  it('Instagram : message avec pièce jointe', () => {
    const [e] = normalizeMetaWebhook({
      object: 'instagram',
      entry: [{ id: 'IG1', messaging: [{
        sender: { id: 'USER2' }, recipient: { id: 'IG1' }, timestamp: 1760000000000,
        message: { mid: 'ig_m1', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] },
      }] }],
    });
    expect(e).toMatchObject({
      provider: 'instagram', accountId: 'IG1', body: null,
      attachments: [{ type: 'image', url: 'https://cdn/x.jpg' }],
    });
  });

  it('ignore accusés de réception, lectures et événements sans message', () => {
    expect(normalizeMetaWebhook({
      object: 'page',
      entry: [{ id: 'PAGE1', messaging: [
        { sender: { id: 'U' }, recipient: { id: 'PAGE1' }, delivery: { mids: ['m1'] } },
        { sender: { id: 'U' }, recipient: { id: 'PAGE1' }, read: { watermark: 1 } },
      ] }],
    })).toEqual([]);
  });
});

describe('normalizeMetaWebhook — commentaires', () => {
  it('Facebook : commentaire de premier niveau', () => {
    const [e] = normalizeMetaWebhook({
      object: 'page',
      entry: [{ id: 'PAGE1', changes: [{ field: 'feed', value: {
        item: 'comment', verb: 'add', comment_id: 'POST1_C1', post_id: 'POST1', parent_id: 'POST1',
        from: { id: 'USER1', name: 'Léa' }, message: 'Superbe !', created_time: 1760000000,
      } }] }],
    });
    expect(e).toMatchObject({
      provider: 'facebook', kind: 'comment_thread', conversationExternalId: 'POST1_C1',
      targetExternalId: 'POST1', direction: 'in', contact: { id: 'USER1', name: 'Léa' }, body: 'Superbe !',
      sentAt: new Date(1760000000 * 1000).toISOString(),
    });
  });

  it('Facebook : réponse sous un commentaire → même conversation que le commentaire parent', () => {
    const [e] = normalizeMetaWebhook({
      object: 'page',
      entry: [{ id: 'PAGE1', changes: [{ field: 'feed', value: {
        item: 'comment', verb: 'add', comment_id: 'C2', post_id: 'POST1', parent_id: 'POST1_C1',
        from: { id: 'PAGE1', name: 'Ma Page' }, message: 'Merci', created_time: 1760000100,
      } }] }],
    });
    expect(e).toMatchObject({ conversationExternalId: 'POST1_C1', direction: 'out' });
  });

  it('Facebook : ignore les réactions, modifications et suppressions', () => {
    const base = { object: 'page', entry: [{ id: 'PAGE1', changes: [] as any[] }] };
    base.entry[0]!.changes.push(
      { field: 'feed', value: { item: 'reaction', verb: 'add' } },
      { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'C1' } },
      { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: 'C1' } },
    );
    expect(normalizeMetaWebhook(base)).toEqual([]);
  });

  it('Instagram : commentaire puis réponse', () => {
    const events = normalizeMetaWebhook({
      object: 'instagram',
      entry: [{ id: 'IG1', time: 1760000000, changes: [
        { field: 'comments', value: { id: 'IGC1', text: 'Trop beau', from: { id: 'U1', username: 'lea_photo' }, media: { id: 'MEDIA1', media_product_type: 'FEED' } } },
        { field: 'comments', value: { id: 'IGC2', parent_id: 'IGC1', text: 'Merci !', from: { id: 'IG1', username: 'ma_marque' }, media: { id: 'MEDIA1' } } },
      ] }],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ conversationExternalId: 'IGC1', targetExternalId: 'MEDIA1', direction: 'in', contact: { id: 'U1', username: 'lea_photo' } });
    expect(events[1]).toMatchObject({ conversationExternalId: 'IGC1', direction: 'out' });
  });

  it('plusieurs entrées dans un même lot', () => {
    const events = normalizeMetaWebhook({
      object: 'page',
      entry: [
        { id: 'P1', messaging: [{ sender: { id: 'U' }, recipient: { id: 'P1' }, timestamp: 1, message: { mid: 'a', text: 'x' } }] },
        { id: 'P2', messaging: [{ sender: { id: 'U' }, recipient: { id: 'P2' }, timestamp: 2, message: { mid: 'b', text: 'y' } }] },
      ],
    });
    expect(events.map((e) => e.accountId)).toEqual(['P1', 'P2']);
  });

  it('renvoie une liste vide pour un corps inattendu', () => {
    for (const body of [null, {}, { object: 'user' }, { object: 'page' }, { object: 'page', entry: 'x' }, 'texte']) {
      expect(normalizeMetaWebhook(body)).toEqual([]);
    }
  });
});
