import { describe, expect, it } from 'vitest';
import {
  filterConversations, replyWindow, sortConversations, splitRemaining, validateReply, MAX_REPLY_LENGTH,
} from './logic';
import type { ConversationSummary } from './types';

const NOW = new Date('2026-10-16T12:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const conv = (o: Partial<ConversationSummary>): ConversationSummary => ({
  id: 'c', networkId: 'instagram', accountName: 'Compte', kind: 'dm', contactName: 'Léa', contactUsername: null,
  status: 'open', assigneeName: null, unreadCount: 0, lastMessageAt: at(-1), lastMessagePreview: 'Bonjour',
  replyWindowExpiresAt: null, ...o,
});

describe('splitRemaining', () => {
  it('découpe en heures et minutes', () => {
    expect(splitRemaining(19 * 3_600_000)).toEqual({ kind: 'hours', h: 19 });
    expect(splitRemaining(2 * 3_600_000 + 15 * 60_000)).toEqual({ kind: 'hoursMinutes', h: 2, m: '15' });
    expect(splitRemaining(2 * 3_600_000 + 5 * 60_000)).toEqual({ kind: 'hoursMinutes', h: 2, m: '05' });
    expect(splitRemaining(12 * 60_000)).toEqual({ kind: 'minutes', m: 12 });
    expect(splitRemaining(10_000)).toEqual({ kind: 'lessThanMinute' });
    expect(splitRemaining(10 * 3_600_000 + 30 * 60_000)).toEqual({ kind: 'hours', h: 10 });
  });
});

describe('replyWindow', () => {
  it('sans fenêtre (commentaires)', () => expect(replyWindow(null, NOW).state).toBe('none'));
  it('ouverte quand il reste plus de 4 h', () => {
    const w = replyWindow(at(19), NOW);
    expect(w.state).toBe('open');
    expect(w.remainingMs).toBe(19 * 3_600_000);
  });
  it('urgente sous 4 h', () => expect(replyWindow(at(3), NOW).state).toBe('urgent'));
  it('urgente pile à 4 h, ouverte juste au-dessus', () => {
    expect(replyWindow(at(4), NOW).state).toBe('urgent');
    expect(replyWindow(at(4.01), NOW).state).toBe('open');
  });
  it('expirée une fois passée', () => {
    expect(replyWindow(at(-1), NOW).state).toBe('expired');
    expect(replyWindow(at(0), NOW).state).toBe('expired');
  });
});

describe('filterConversations', () => {
  const list = [
    conv({ id: 'a', contactName: 'Léa Marchand', unreadCount: 2, networkId: 'instagram' }),
    conv({ id: 'b', contactName: 'Karim', status: 'closed', networkId: 'facebook', lastMessagePreview: 'Merci beaucoup' }),
    conv({ id: 'c', contactName: 'Zoé', status: 'pending', networkId: 'youtube', contactUsername: 'zoe_vlog' }),
  ];
  it('par statut', () => {
    expect(filterConversations(list, { status: 'closed' }).map((c) => c.id)).toEqual(['b']);
    expect(filterConversations(list, { status: 'all' })).toHaveLength(3);
  });
  it('actives = tout sauf fermées', () => expect(filterConversations(list, { status: 'active' }).map((c) => c.id)).toEqual(['a', 'c']));
  it('non lus', () => expect(filterConversations(list, { status: 'unread' }).map((c) => c.id)).toEqual(['a']));
  it('par réseau', () => expect(filterConversations(list, { network: 'youtube' }).map((c) => c.id)).toEqual(['c']));
  it('recherche sans accents ni casse, dans le nom, le pseudo et l’aperçu', () => {
    expect(filterConversations(list, { q: 'lea' }).map((c) => c.id)).toEqual(['a']);
    expect(filterConversations(list, { q: 'ZOE_VLOG' }).map((c) => c.id)).toEqual(['c']);
    expect(filterConversations(list, { q: 'merci' }).map((c) => c.id)).toEqual(['b']);
    expect(filterConversations(list, { q: 'zoe' }).map((c) => c.id)).toEqual(['c']);
  });
  it('combine les filtres', () => expect(filterConversations(list, { status: 'open', network: 'facebook' })).toEqual([]));
});

describe('sortConversations', () => {
  it('urgentes d’abord (la plus proche de l’expiration en premier), puis récentes, fermées en dernier', () => {
    const list = [
      conv({ id: 'recent', lastMessageAt: at(-1) }),
      conv({ id: 'old', lastMessageAt: at(-10) }),
      conv({ id: 'urgent-2h', replyWindowExpiresAt: at(2), lastMessageAt: at(-22) }),
      conv({ id: 'urgent-1h', replyWindowExpiresAt: at(1), lastMessageAt: at(-23) }),
      conv({ id: 'closed', status: 'closed', lastMessageAt: at(0) }),
      conv({ id: 'open-window', replyWindowExpiresAt: at(20), lastMessageAt: at(-4) }),
    ];
    expect(sortConversations(list, NOW).map((c) => c.id)).toEqual(['urgent-1h', 'urgent-2h', 'recent', 'open-window', 'old', 'closed']);
  });
  it('ne modifie pas la liste d’origine', () => {
    const list = [conv({ id: 'a', lastMessageAt: at(-5) }), conv({ id: 'b', lastMessageAt: at(-1) })];
    sortConversations(list, NOW);
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('validateReply', () => {
  const open = replyWindow(at(10), NOW);
  const expired = replyWindow(at(-1), NOW);
  it('refuse un message vide ou trop long', () => {
    expect(validateReply('   ', open)).toEqual({ key: 'app.validation.replyEmpty' });
    expect(validateReply('x'.repeat(MAX_REPLY_LENGTH + 1), open)).toEqual({ key: 'app.validation.replyTooLong', params: { max: MAX_REPLY_LENGTH } });
  });
  it('refuse hors fenêtre de 24 h', () => expect(validateReply('Bonjour', expired)).toEqual({ key: 'app.validation.windowExpired' }));
  it('accepte un message valide', () => {
    expect(validateReply('Bonjour', open)).toBeNull();
    expect(validateReply('Bonjour', replyWindow(null, NOW))).toBeNull();
  });
});
