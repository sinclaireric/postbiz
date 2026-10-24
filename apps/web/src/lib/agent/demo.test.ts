import { describe, expect, it } from 'vitest';
import type { T } from '@/i18n/types';
import type { IntegrationItem, MediaItem, PostItem } from '@/lib/data/types';
import { countLength } from '@/lib/text/length';
import { demoHashtags, demoSubject, demoText, runDemoTurn, type DemoTurnDeps } from './demo';
import type { AgentEvent } from './types';

const t = ((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)) as unknown as T;
const channel = (id: string, networkId: IntegrationItem['networkId'], name: string, status: IntegrationItem['status'] = 'active'): IntegrationItem => ({ id, networkId, name, username: null, pictureUrl: null, status });
const media = (id: string, kind: 'image' | 'video'): MediaItem => ({ id, path: id, name: `${id}`, mimeType: null, kind, sizeBytes: null, width: 1080, height: 1350, durationSeconds: null, alt: '', createdAt: '2026-01-01T00:00:00Z', url: `u/${id}`, thumbUrl: `t/${id}` });

const library = [media('v1', 'video'), media('m1', 'image')];
const post = (id: string, integrationId: string, publishAt: string, content: string): PostItem => ({
  id, groupId: id, integrationId, networkId: 'facebook', accountName: 'Maison Lune', content, publishAt, state: 'queued', error: null, releaseUrl: null, firstComment: null, firstCommentState: null, firstCommentError: null, media: [],
});

let n = 0;
function setup(over: Partial<DemoTurnDeps> = {}) {
  const events: AgentEvent[] = [];
  const deps: DemoTurnDeps = {
    t, channels: [channel('fb', 'facebook', 'Maison Lune'), channel('ig', 'instagram', 'maison.lune'), channel('x', 'x', 'X'), channel('li', 'linkedin', 'Camille')], library,
    posts: [], timeZone: 'Europe/Paris', now: new Date('2026-10-27T10:00:00Z'), emit: (e) => events.push(e), newId: () => `d${++n}`, paceMs: 0, ...over,
  };
  return { deps, events };
}

describe('demoSubject et demoText', () => {
  it('retire le verbe d’ordre et ne garde que les mots de l’utilisateur', () => {
    expect(demoSubject('Annonce l’atelier ouvert samedi')).toBe('Atelier ouvert samedi');
    expect(demoSubject('Publie un post sur la collection d’automne')).toBe('Collection d’automne');
    expect(demoSubject('Write a post about our new bench')).toBe('Our new bench');
    expect(demoSubject('Atelier ouvert samedi')).toBe('Atelier ouvert samedi');
  });

  it('tire les hashtags des mots du sujet', () => {
    expect(demoHashtags('Atelier ouvert samedi, venez découvrir')).toBe('#atelier #ouvert #samedi');
    expect(demoHashtags('Un petit mot')).toBe('');
  });

  it('met le texte à la forme du réseau et sous sa limite (X compte pondéré)', () => {
    const subject = 'Atelier ouvert samedi';
    expect(demoText('facebook', subject)).toBe(subject);
    expect(demoText('instagram', subject)).toContain('#atelier');
    const long = 'Atelier ouvert samedi. '.repeat(30);
    const x = demoText('x', long);
    expect(countLength('x', x)).toBeLessThanOrEqual(280);
    expect(x.endsWith('…')).toBe(true);
  });
});

describe('runDemoTurn : préparer des publications', () => {
  it('prépare une publication par canal utilisable, validée comme celles du vrai agent', async () => {
    const { deps, events } = setup();
    const r = await runDemoTurn(deps, 'Annonce l’atelier ouvert samedi');

    expect(r.proposals.map((p) => p.networkId)).toEqual(['facebook', 'instagram', 'x', 'linkedin']);
    expect(r.proposals.every((p) => p.status === 'pending' && p.publishAt === null)).toBe(true);
    // Instagram exige un média : l'agent en prend un dans la bibliothèque, jamais une vidéo si une image existe.
    expect(r.proposals.find((p) => p.networkId === 'instagram')!.mediaIds).toEqual(['m1']);
    expect(r.proposals.find((p) => p.networkId === 'facebook')!.mediaIds).toEqual([]);
    expect(r.media.map((m) => m.id)).toEqual(['m1']);
    expect(r.text).toContain('app.agent.demo.intro');
    expect(r.usage.calls).toBe(0);
    expect(events.map((e) => e.type)).toContain('proposals');
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe(r.text);
  });

  it('propose demain 9 h (heure locale) quand l’utilisateur dit « demain »', async () => {
    const { deps } = setup({ channels: [channel('fb', 'facebook', 'Maison Lune')] });
    const r = await runDemoTurn(deps, 'Annonce l’atelier demain');
    expect(r.proposals[0]!.publishAt).toBe('2026-10-28T08:00:00.000Z');
  });

  it('laisse de côté un réseau qui exige un média quand la bibliothèque n’en a pas, et le dit', async () => {
    const { deps } = setup({ library: [], channels: [channel('fb', 'facebook', 'Maison Lune'), channel('ig', 'instagram', 'maison.lune')] });
    const r = await runDemoTurn(deps, 'Annonce l’atelier');
    expect(r.proposals.map((p) => p.networkId)).toEqual(['facebook']);
    expect(r.text).toContain('app.agent.demo.skipped {"networks":"Instagram"}');
  });

  it('utilise le média joint par l’utilisateur', async () => {
    const { deps } = setup({ channels: [channel('ig', 'instagram', 'maison.lune')] });
    const r = await runDemoTurn(deps, 'Annonce ma photo', [media('mine', 'image')]);
    expect(r.proposals[0]!.mediaIds).toEqual(['mine']);
  });

  it('ne prépare rien pour TikTok et YouTube, qui ne publient pas encore, ni pour un canal à reconnecter', async () => {
    const { deps } = setup({ channels: [channel('tt', 'tiktok', 'TikTok'), channel('yt', 'youtube', 'YouTube'), channel('old', 'facebook', 'Ancien', 'refresh_needed')] });
    const r = await runDemoTurn(deps, 'Annonce l’atelier');
    expect(r.proposals).toEqual([]);
    expect(r.text).toContain('app.agent.demo.skipped');
  });

  it('demande de cocher un canal quand il n’y en a aucun', async () => {
    const { deps } = setup({ channels: [] });
    expect((await runDemoTurn(deps, 'Annonce l’atelier')).text).toBe('app.agent.demo.noChannel');
  });

  it('se présente quand le message est trop court pour être une demande', async () => {
    const { deps } = setup();
    expect((await runDemoTurn(deps, 'Salut')).text).toBe('app.agent.demo.help');
  });

  it('est déterministe : la même demande donne les mêmes textes', async () => {
    const a = await runDemoTurn(setup().deps, 'Annonce l’atelier ouvert samedi');
    const b = await runDemoTurn(setup().deps, 'Annonce l’atelier ouvert samedi');
    expect(a.proposals.map((p) => p.text)).toEqual(b.proposals.map((p) => p.text));
  });
});

describe('runDemoTurn : consulter le calendrier', () => {
  const posts = [
    post('p1', 'fb', '2026-10-30T08:00:00Z', 'Atelier ouvert ce samedi'),
    post('p2', 'fb', '2026-10-20T08:00:00Z', 'Déjà passée'),
    post('p3', 'other', '2026-10-29T08:00:00Z', 'Autre canal'),
    post('p4', 'fb', '2026-12-30T08:00:00Z', 'Trop loin'),
  ];

  it('liste les publications à venir des canaux cochés, dans l’ordre', async () => {
    const { deps, events } = setup({ posts, channels: [channel('fb', 'facebook', 'Maison Lune')] });
    const r = await runDemoTurn(deps, 'Qu’est-ce qui est prévu cette semaine ?');
    expect(r.text).toContain('app.agent.demo.upcoming');
    expect(r.text).toContain('2026-10-30 09:00 · Facebook · Atelier ouvert ce samedi');
    expect(r.text).not.toContain('Déjà passée');
    expect(r.text).not.toContain('Autre canal');
    expect(r.text).not.toContain('Trop loin');
    expect(r.proposals).toEqual([]);
    expect(events[0]).toEqual({ type: 'tool', name: 'list_posts' });
  });

  it('dit que rien n’est prévu quand le calendrier est vide', async () => {
    const { deps } = setup();
    expect((await runDemoTurn(deps, 'Montre le planning')).text).toBe('app.agent.demo.noPosts');
  });

  it('une demande d’écriture qui parle de calendrier reste une demande d’écriture', async () => {
    const { deps } = setup();
    expect((await runDemoTurn(deps, 'Annonce l’atelier dans le calendrier')).proposals.length).toBeGreaterThan(0);
  });
});
