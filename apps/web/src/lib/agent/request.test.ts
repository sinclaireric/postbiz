import { describe, expect, it } from 'vitest';
import { createEventParser, encodeEvent, parseChatRequest, parseEventLine, parseSaveRequest } from './request';
import { AGENT_LIMITS, type AgentEvent } from './types';

const ok = { threadId: null, message: '  Annonce l’atelier de samedi  ', channelIds: ['i1', 'i2'], mediaIds: ['m1'], timeZone: 'Europe/Paris' };

describe('parseChatRequest', () => {
  it('lit une requête valide et nettoie le message', () => {
    expect(parseChatRequest(ok)).toEqual({ threadId: null, message: 'Annonce l’atelier de samedi', channelIds: ['i1', 'i2'], mediaIds: ['m1'], timeZone: 'Europe/Paris' });
  });

  it('accepte une conversation existante, des listes absentes, un message réduit à des médias', () => {
    expect(parseChatRequest({ message: 'Suite', threadId: 'abc-123' })).toMatchObject({ threadId: 'abc-123', channelIds: [], mediaIds: [] });
    expect(parseChatRequest({ message: '', mediaIds: ['m1'] })).toMatchObject({ message: '', mediaIds: ['m1'] });
  });

  it('retombe sur UTC si le fuseau est faux, et dédoublonne les listes', () => {
    expect(parseChatRequest({ ...ok, timeZone: 'Atlantide/Centre' })!.timeZone).toBe('UTC');
    expect(parseChatRequest({ ...ok, channelIds: ['a', 'a', 'b'] })!.channelIds).toEqual(['a', 'b']);
  });

  it.each([
    ['rien', null],
    ['une liste', []],
    ['un message vide sans média', { ...ok, message: '   ', mediaIds: [] }],
    ['un message démesuré', { ...ok, message: 'a'.repeat(AGENT_LIMITS.message + 1) }],
    ['un message qui n’est pas du texte', { ...ok, message: 42 }],
    ['des canaux qui ne sont pas des textes', { ...ok, channelIds: [1] }],
    ['un identifiant de canal étrange', { ...ok, channelIds: ['../../etc'] }],
    ['une liste de canaux qui n’en est pas une', { ...ok, channelIds: 'i1' }],
    ['un identifiant de conversation étrange', { ...ok, threadId: 'a b' }],
    ['un identifiant de conversation qui n’est pas du texte', { ...ok, threadId: 3 }],
  ])('refuse %s', (_, body) => {
    expect(parseChatRequest(body)).toBeNull();
  });

  it('borne le nombre de canaux et de médias', () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const r = parseChatRequest({ ...ok, channelIds: many, mediaIds: many })!;
    expect(r.channelIds).toHaveLength(AGENT_LIMITS.channels);
    expect(r.mediaIds).toHaveLength(AGENT_LIMITS.mediaPerMessage);
  });
});

describe('flux d’événements', () => {
  const events: AgentEvent[] = [{ type: 'text', delta: 'Bonjour\nà tous' }, { type: 'tool', name: 'list_media' }, { type: 'error', code: 'failed' }];

  it('un événement par ligne, y compris quand le texte contient un retour à la ligne', () => {
    const wire = events.map(encodeEvent).join('');
    expect(wire.trimEnd().split('\n')).toHaveLength(3);
    const p = createEventParser();
    expect([...p.push(wire), ...p.flush()]).toEqual(events);
  });

  it('recolle une ligne coupée en deux morceaux, à n’importe quel endroit', () => {
    const wire = events.map(encodeEvent).join('');
    for (let cut = 1; cut < wire.length; cut += 7) {
      const p = createEventParser();
      expect([...p.push(wire.slice(0, cut)), ...p.push(wire.slice(cut)), ...p.flush()]).toEqual(events);
    }
  });

  it('ignore une ligne abîmée ou étrangère sans arrêter la lecture', () => {
    const p = createEventParser();
    const out = [...p.push('pas du json\n{"type":"inconnu"}\n[1]\nnull\n' + encodeEvent(events[1]!)), ...p.flush()];
    expect(out).toEqual([events[1]]);
    expect(parseEventLine('')).toBeNull();
  });

  it('lit la dernière ligne même sans retour à la ligne final', () => {
    const p = createEventParser();
    expect([...p.push(JSON.stringify(events[2])), ...p.flush()]).toEqual([events[2]]);
  });
});

describe('parseSaveRequest', () => {
  const item = { id: 'p1', integrationId: 'fb', text: 'Atelier ouvert samedi', firstComment: null, mediaIds: ['m1'], publishAt: '2026-10-28T09:00:00+01:00' };
  const ok = { threadId: 't1', messageId: 'm9', mode: 'schedule', items: [item] };

  it('lit une demande valide et normalise la date en UTC', () => {
    expect(parseSaveRequest(ok)).toEqual({ threadId: 't1', messageId: 'm9', mode: 'schedule', items: [{ ...item, publishAt: '2026-10-28T08:00:00.000Z' }] });
  });

  it('accepte un brouillon sans date ni premier commentaire', () => {
    const r = parseSaveRequest({ ...ok, mode: 'draft', items: [{ id: 'p1', integrationId: 'fb', text: 'Bonjour' }] });
    expect(r!.items[0]).toEqual({ id: 'p1', integrationId: 'fb', text: 'Bonjour', firstComment: null, mediaIds: [], publishAt: null });
  });

  it.each([
    ['rien', null],
    ['un mode inconnu', { ...ok, mode: 'publish' }],
    ['aucune publication', { ...ok, items: [] }],
    ['trop de publications', { ...ok, items: Array.from({ length: 9 }, (_, i) => ({ ...item, id: `p${i}` })) }],
    ['un identifiant étrange', { ...ok, messageId: '../x' }],
    ['une publication qui n’en est pas une', { ...ok, items: ['x'] }],
    ['un texte qui n’en est pas un', { ...ok, items: [{ ...item, text: 4 }] }],
    ['un texte démesuré', { ...ok, items: [{ ...item, text: 'a'.repeat(20_001) }] }],
    ['une date illisible', { ...ok, items: [{ ...item, publishAt: 'demain' }] }],
    ['un commentaire qui n’en est pas un', { ...ok, items: [{ ...item, firstComment: 4 }] }],
    ['des médias qui n’en sont pas', { ...ok, items: [{ ...item, mediaIds: [1] }] }],
    ['deux fois la même publication', { ...ok, items: [item, item] }],
  ])('refuse %s', (_, body) => {
    expect(parseSaveRequest(body)).toBeNull();
  });
});
