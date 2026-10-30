import { describe, expect, it } from 'vitest';
import {
  checkSendLimits, cleanSupportBody, isConversationId, mergeMessages, parseAdminThread, parseMessage, parseSummary, parseSupportQuery, parseSupportRow, parseThread,
  supportErrorCode, supportHref, supportNotificationHref, validateSupportBody, SUPPORT_MAX_UNANSWERED, SUPPORT_USER_MAX,
} from './logic';
import type { SupportMessage } from './types';

const ID = '5b0a8a7e-3c1d-4f6e-9a2b-0c1d2e3f4a5b';
const msg = (id: string, author: 'user' | 'support', createdAt: string, body = id): SupportMessage => ({ id, author, body, createdAt });

describe('cleanSupportBody (miroir de support_clean_body)', () => {
  it('donne le même résultat que la base sur l’exemple du test PGlite', () => {
    // Même texte, même résultat que packages/db/test/support-chat.test.ts : si l'un change, l'autre doit suivre.
    expect(cleanSupportBody('  Bonjour\r\n\r\n\r\n\r\nvoici‮ txt.exe⁦ \u0007et\u001B fin  ')).toBe('Bonjour\n\nvoici txt.exe et fin');
  });

  it('garde le HTML, les liens, les emojis et les langues écrites de droite à gauche tels quels', () => {
    const text = '<script>alert(1)</script> https://exemple.test/?a=1&b=2 😀 مرحبا';
    expect(cleanSupportBody(text)).toBe(text);
  });

  it('normalise les fins de ligne et garde tabulations et sauts de ligne', () => {
    expect(cleanSupportBody('a\r\nb\rc\td')).toBe('a\nb\nc\td');
  });

  it('ne laisse que des blancs ou des caractères invisibles : vide', () => {
    expect(cleanSupportBody(' \n\t ‮\u0007 ')).toBe('');
  });
});

describe('validateSupportBody', () => {
  it('refuse le vide et ce qui dépasse la limite, compte en points de code', () => {
    expect(validateSupportBody('', SUPPORT_USER_MAX)).toBe('invalid_message');
    expect(validateSupportBody('x'.repeat(SUPPORT_USER_MAX), SUPPORT_USER_MAX)).toBeNull();
    expect(validateSupportBody('x'.repeat(SUPPORT_USER_MAX + 1), SUPPORT_USER_MAX)).toBe('message_too_long');
    // 2 000 emojis = 4 000 unités UTF-16 mais 2 000 caractères : accepté, comme dans la base
    expect(validateSupportBody('😀'.repeat(2_000), SUPPORT_USER_MAX)).toBeNull();
  });
});

describe('supportErrorCode', () => {
  it('reconnaît les erreurs levées par la base et ramène le reste à « failed »', () => {
    expect(supportErrorCode({ message: 'rate_limited' })).toBe('rate_limited');
    expect(supportErrorCode({ message: 'too_many_unanswered' })).toBe('too_many_unanswered');
    expect(supportErrorCode({ message: 'message_too_long' })).toBe('message_too_long');
    expect(supportErrorCode({ message: 'invalid_message' })).toBe('invalid_message');
    expect(supportErrorCode({ message: 'account suspended' })).toBe('failed');
    expect(supportErrorCode({ message: 'permission denied for function support_send' })).toBe('failed');
    expect(supportErrorCode(null)).toBe('failed');
  });
});

describe('checkSendLimits (miroir des limites de support_send)', () => {
  const now = Date.parse('2026-11-04T10:00:00Z');
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

  it('laisse écrire en dessous des limites', () => {
    expect(checkSendLimits([], now)).toBeNull();
    expect(checkSendLimits([msg('a', 'user', at(5)), msg('b', 'user', at(4))], now)).toBeNull();
  });

  it('refuse un sixième message dans la minute', () => {
    const burst = [50, 40, 30, 20, 10].map((s, i) => msg(`m${i}`, 'user', at(s)));
    expect(checkSendLimits(burst, now)).toBe('rate_limited');
    expect(checkSendLimits(burst, now + 60_000)).toBeNull(); // une minute plus tard
  });

  it('refuse après 20 messages sans réponse, et une réponse du support remet le compte à zéro', () => {
    const old = Array.from({ length: SUPPORT_MAX_UNANSWERED }, (_, i) => msg(`u${i}`, 'user', at(3600 + SUPPORT_MAX_UNANSWERED - i)));
    expect(checkSendLimits(old, now)).toBe('too_many_unanswered');
    expect(checkSendLimits([...old, msg('r', 'support', at(1800))], now)).toBeNull();
    expect(checkSendLimits(old.slice(1), now)).toBeNull(); // 19 seulement
  });
});

describe('lecture des lignes de la base', () => {
  it('lit un message et ignore une ligne sans identifiant ni texte', () => {
    expect(parseMessage({ id: 'a', author: 'support', body: 'Bonjour', created_at: '2026-11-04T10:00:00Z', sent_by: 'ignoré' })).toEqual({ id: 'a', author: 'support', body: 'Bonjour', createdAt: '2026-11-04T10:00:00Z' });
    expect(parseMessage({ author: 'user', body: 'x' })).toBeNull();
    expect(parseMessage({ id: 'a' })).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage({ id: 'a', author: 'n’importe quoi', body: 'x' })?.author).toBe('user');
  });

  it('ordonne un fil par date puis identifiant, sans doublon', () => {
    const merged = mergeMessages(
      [msg('b', 'user', '2026-11-04T10:00:02Z'), msg('a', 'user', '2026-11-04T10:00:01Z')],
      [msg('b', 'user', '2026-11-04T10:00:02Z'), msg('c', 'support', '2026-11-04T10:00:03Z'), msg('d', 'support', '2026-11-04T10:00:03Z')],
    );
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lit la conversation d’une personne ; sans ligne, elle n’existe pas encore', () => {
    expect(parseThread(null, [])).toEqual({ conversationId: null, status: 'open', unread: 0, messages: [] });
    const t = parseThread({ id: ID, status: 'resolved', user_unread: 2 }, [
      { id: 'b', author: 'support', body: 'Réponse', created_at: '2026-11-04T10:00:02Z' }, { id: 'a', author: 'user', body: 'Question', created_at: '2026-11-04T10:00:01Z' }, { nope: true },
    ]);
    expect(t).toMatchObject({ conversationId: ID, status: 'resolved', unread: 2 });
    expect(t.messages.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('lit le résumé, une ligne de liste et un fil du propriétaire', () => {
    expect(parseSummary({ all: 4, open: 3, resolved: 1, unread: 2, unread_messages: '5' })).toEqual({ all: 4, open: 3, resolved: 1, unread: 2, unreadMessages: 5 });
    expect(parseSummary(null)).toEqual({ all: 0, open: 0, resolved: 0, unread: 0, unreadMessages: 0 });
    expect(parseSupportRow({ id: ID, user_id: 'u', display_name: 'Léa', email: 'lea@x.test', org_name: 'Atelier', status: 'open', support_unread: 1, message_count: 3, last_author: 'user', last_body: 'Salut', last_message_at: '2026-11-04T10:00:00Z' }))
      .toMatchObject({ id: ID, name: 'Léa', email: 'lea@x.test', orgName: 'Atelier', supportUnread: 1, messageCount: 3, lastAuthor: 'user', lastBody: 'Salut' });
    const t = parseAdminThread({
      conversation: { id: ID, user_id: 'u', display_name: null, email: 'lea@x.test', org_name: null, status: 'open', support_unread: 1, user_unread: 0, resolved_at: null },
      messages: [{ id: 'a', author: 'user', body: 'Salut', created_at: '2026-11-04T10:00:00Z' }], truncated: true,
    });
    expect(t).toMatchObject({ conversation: { id: ID, email: 'lea@x.test', resolvedAt: null }, truncated: true });
    expect(t?.messages).toHaveLength(1);
    expect(parseAdminThread(null)).toBeNull();
    expect(parseAdminThread({ conversation: null, messages: [] })).toBeNull();
  });
});

describe('adresses de l’espace propriétaire', () => {
  it('lit le filtre, la recherche et la page, avec des valeurs sûres par défaut', () => {
    expect(parseSupportQuery({})).toEqual({ filter: 'all', search: '', page: 1 });
    expect(parseSupportQuery({ filtre: 'unread', q: '  lea   martin ', page: '3' })).toEqual({ filter: 'unread', search: 'lea martin', page: 3 });
    expect(parseSupportQuery({ filtre: 'nimportequoi', page: '-4' })).toEqual({ filter: 'all', search: '', page: 1 });
    expect(parseSupportQuery({ q: 'x'.repeat(500) }).search).toHaveLength(100);
  });

  it('refait l’adresse sans les valeurs par défaut', () => {
    expect(supportHref('/admin/support', {})).toBe('/admin/support');
    expect(supportHref('/admin/support', { filter: 'all', page: 1 })).toBe('/admin/support');
    expect(supportHref('/admin/support', { filter: 'open', search: 'a&b', page: 2 })).toBe('/admin/support?filtre=open&q=a%26b&page=2');
  });

  it('ne reconnaît un identifiant de conversation que s’il a la forme d’un UUID', () => {
    expect(isConversationId(ID)).toBe(true);
    expect(isConversationId('../../etc')).toBe(false);
    expect(isConversationId(`${ID}x`)).toBe(false);
  });

  it('mène une notification de réponse au chat, une notification du propriétaire à la conversation, et ignore le reste', () => {
    expect(supportNotificationHref('support_reply', { screen: 'support' })).toBe('/app/support');
    expect(supportNotificationHref('support_message', { support_conversation_id: ID })).toBe(`/admin/support/${ID}`);
    expect(supportNotificationHref('support_message', { support_conversation_id: '../x' })).toBeNull();
    expect(supportNotificationHref('support_message', {})).toBeNull();
    expect(supportNotificationHref('post_error', { support_conversation_id: ID })).toBeNull();
  });
});
