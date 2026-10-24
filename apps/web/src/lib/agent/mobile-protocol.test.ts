import { describe, expect, it } from 'vitest';
import { createEventParser as mobileParser, sanitizeProposals as mobileSanitize } from '../../../../mobile/lib/agent-protocol';
import { countLength as mobileCount } from '../../../../mobile/lib/text-length';
import { countLength } from '@/lib/text/length';
import { sanitizeProposals } from './proposal';
import { createEventParser, encodeEvent } from './request';
import type { AgentEvent } from './types';

// L'application mobile ne partage pas de code avec le web (deux projets, deux gestionnaires de paquets) : elle garde un miroir du protocole de l'agent et du
// calcul des longueurs. Ces tests font tourner le web et le miroir sur les mêmes entrées : si l'un change sans l'autre, ils échouent ici.

const thread = { id: 't1', title: 'Annonce', updatedAt: '2026-10-27T10:00:00Z' };
const msg = (role: 'user' | 'assistant', text: string) => ({ id: role, role, text, proposals: [], mediaIds: [], createdAt: '2026-10-27T10:00:00Z' });
const proposal = { id: 'p1', integrationId: 'i1', networkId: 'linkedin' as const, accountName: 'Camille', text: 'Texte', firstComment: null, mediaIds: ['m1'], publishAt: null, status: 'pending' as const };

const events: AgentEvent[] = [
  { type: 'text', delta: 'Bonjour\nà tous' },
  { type: 'tool', name: 'list_posts' },
  { type: 'tool', name: 'list_media' },
  { type: 'tool', name: 'propose_posts' },
  { type: 'proposals', proposals: [proposal], media: [{ id: 'm1', kind: 'image', name: 'a.jpg', alt: '', url: null, thumbUrl: null, durationSeconds: null }] },
  { type: 'done', thread, user: msg('user', 'Salut'), assistant: msg('assistant', 'Oui') },
  ...(['disabled', 'forbidden', 'invalid', 'rate_limited', 'refused', 'empty', 'failed', 'not_found'] as const).map((code): AgentEvent => ({ type: 'error', code })),
];

describe('protocole de l’agent : le web et le miroir du mobile lisent la même chose', () => {
  const wire = events.map(encodeEvent).join('');
  const noise = 'pas du json\n{"type":"inconnu"}\n[1]\nnull\n';

  it('mêmes événements, mêmes lignes ignorées', () => {
    const web = createEventParser();
    const mobile = mobileParser();
    expect([...mobile.push(noise + wire), ...mobile.flush()]).toEqual([...web.push(noise + wire), ...web.flush()]);
    expect([...mobile.push(noise + wire), ...mobile.flush()]).toEqual(events);
  });

  it('mêmes découpes de ligne', () => {
    for (let cut = 1; cut < wire.length; cut += 11) {
      const web = createEventParser();
      const mobile = mobileParser();
      expect([...mobile.push(wire.slice(0, cut)), ...mobile.push(wire.slice(cut)), ...mobile.flush()]).toEqual([...web.push(wire.slice(0, cut)), ...web.push(wire.slice(cut)), ...web.flush()]);
    }
  });
});

describe('longueur d’un texte : le mobile compte comme le web', () => {
  const samples = ['', 'Atelier ouvert samedi', 'a'.repeat(280), 'a'.repeat(281), 'Bonjour 🎉🎉', '𝗯𝗼𝗻𝗷𝗼𝘂𝗿 en gras', 'Lisez : https://exemple.fr/un-tres-long-lien?x=1 et http://a.fr', '日本語のテキスト', '👨‍👩‍👧‍👦 famille', 'é'.repeat(300)];
  for (const network of ['x', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube'] as const) {
    it(network, () => {
      for (const text of samples) expect(mobileCount(network, text), `${network} : ${text.slice(0, 20)}`).toBe(countLength(network, text));
    });
  }
});

describe('publications gardées dans un message : le mobile les relit comme le web', () => {
  const good = { id: 'p1', integrationId: 'fb', networkId: 'facebook', accountName: 'Maison Lune', text: 'Bonjour', firstComment: null, mediaIds: ['m1'], publishAt: '2026-10-28T08:00:00.000Z', status: 'draft' };
  const inputs: unknown[] = [
    [good], 'non', null, [null, 'x', { ...good, id: 3 }, { ...good, networkId: 'myspace' }, { ...good, status: 'published' }, { ...good, text: 'a'.repeat(20_001) }, good],
    [{ ...good, publishAt: 'demain', mediaIds: ['m1', 4, null], firstComment: 7 }], [{ ...good, networkId: 'linkedin_page' }, { ...good, networkId: 'instagram_standalone', id: 'p2' }],
    [{ ...good, accountName: 'x'.repeat(201) }], [{ ...good, mediaIds: Array.from({ length: 30 }, (_, i) => `m${i}`) }],
  ];
  it.each(inputs.map((input, i) => [i, input] as const))('cas %i', (_, input) => {
    expect(mobileSanitize(input)).toEqual(sanitizeProposals(input));
  });
});
