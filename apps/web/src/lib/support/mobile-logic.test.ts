import { describe, expect, it } from 'vitest';
import {
  cleanSupportBody as mobileClean, mergeSupportMessages as mobileMerge, parseSupportMessage as mobileParse, supportErrorCode as mobileCode, validateSupportBody as mobileValidate,
  SUPPORT_THREAD_LIMIT as MOBILE_LIMIT, SUPPORT_USER_MAX as MOBILE_MAX,
} from '../../../../mobile/lib/support-logic';
import { SUPPORT_THREAD_LIMIT, SUPPORT_USER_MAX, cleanSupportBody, mergeMessages, parseMessage, supportErrorCode, validateSupportBody } from './logic';

// L'application mobile ne partage pas de code avec le web : elle garde un miroir des règles du chat (apps/mobile/lib/support-logic.ts). Ces tests font tourner
// les deux versions sur les mêmes entrées : si l'une change sans l'autre, ils échouent ici.

const texts = [
  '', '   ', '  Bonjour  ', 'a\r\nb\rc\td', '  Bonjour\r\n\r\n\r\n\r\nvoici‮ txt.exe⁦ \u0007et\u001B fin  ', '‮\u0007', '\n\n\n\nx\n\n\n\n',
  '<script>alert(1)</script> https://exemple.test/?a=1&b=2 😀 مرحبا', 'x'.repeat(2000), 'x'.repeat(2001), '😀'.repeat(2000), '😀'.repeat(2001), 'a\u000Bb\u007Fc', 'a \n \nb',
];

describe('miroir mobile du chat de support', () => {
  it('a les mêmes limites', () => {
    expect(MOBILE_MAX).toBe(SUPPORT_USER_MAX);
    expect(MOBILE_LIMIT).toBe(SUPPORT_THREAD_LIMIT);
  });

  it('nettoie et valide le texte comme le web', () => {
    for (const text of texts) {
      expect(mobileClean(text), JSON.stringify(text.slice(0, 30))).toBe(cleanSupportBody(text));
      expect(mobileValidate(mobileClean(text))).toBe(validateSupportBody(cleanSupportBody(text), SUPPORT_USER_MAX));
    }
  });

  it('lit les erreurs de la base et les lignes de messages comme le web', () => {
    for (const message of ['rate_limited', 'too_many_unanswered', 'message_too_long', 'invalid_message', 'account suspended', 'permission denied', '']) {
      expect(mobileCode({ message })).toBe(supportErrorCode({ message }));
    }
    expect(mobileCode(null)).toBe(supportErrorCode(null));
    const rows = [{ id: 'a', author: 'support', body: 'x', created_at: '2026-11-04T10:00:00Z' }, { id: 'b', author: '?', body: 'y' }, { body: 'z' }, null, { id: 'c' }];
    for (const row of rows) expect(mobileParse(row)).toEqual(parseMessage(row));
  });

  it('fusionne les fils dans le même ordre', () => {
    const m = (id: string, createdAt: string) => ({ id, author: 'user' as const, body: id, createdAt });
    const a = [m('b', '2026-11-04T10:00:02Z'), m('a', '2026-11-04T10:00:01Z')];
    const b = [m('b', '2026-11-04T10:00:02Z'), m('d', '2026-11-04T10:00:03Z'), m('c', '2026-11-04T10:00:03Z')];
    expect(mobileMerge(a, b)).toEqual(mergeMessages(a, b));
  });
});
