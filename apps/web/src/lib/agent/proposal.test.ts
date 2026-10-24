import { describe, expect, it } from 'vitest';
import type { IntegrationItem, MediaItem } from '@/lib/data/types';
import { describeError, mediaIdsOf, parseProposeInput, sanitizeProposals, type ProposeContext } from './proposal';

const channel = (id: string, networkId: IntegrationItem['networkId'], name: string, status: IntegrationItem['status'] = 'active'): IntegrationItem => ({ id, networkId, name, username: null, pictureUrl: null, status });
const media = (id: string, kind: 'image' | 'video', w = 1080, h = 1350): MediaItem => ({
  id, path: id, name: `${id}.${kind === 'image' ? 'jpg' : 'mp4'}`, mimeType: null, kind, sizeBytes: null, width: w, height: h, durationSeconds: null, alt: '', createdAt: '2026-01-01T00:00:00Z', url: null, thumbUrl: null,
});

const now = new Date('2026-10-27T10:00:00Z');
let n = 0;
const ctx = (over: Partial<ProposeContext> = {}): ProposeContext => ({
  channels: [channel('fb', 'facebook', 'Maison Lune'), channel('ig', 'instagram', 'maison.lune'), channel('x', 'x', 'Maison Lune X'), channel('li', 'linkedin', 'Camille'), channel('old', 'facebook', 'Ancien', 'refresh_needed')],
  media: new Map([media('m1', 'image'), media('m2', 'video'), media('m3', 'image', 3000, 500)].map((m) => [m.id, m])),
  timeZone: 'Europe/Paris', now, newId: () => `p${++n}`, ...over,
});

const post = (over: Record<string, unknown> = {}) => ({ channel_id: 'fb', text: 'Atelier ouvert samedi !', ...over });
const run = (posts: unknown[], over?: Partial<ProposeContext>) => parseProposeInput({ posts }, ctx(over));

describe('parseProposeInput : cas valides', () => {
  it('prépare une publication par canal, en attente de relecture', () => {
    const r = run([post(), post({ channel_id: 'li', text: 'Un long post.\n\nSuite.' })]);
    expect(r.ok && r.proposals).toMatchObject([
      { integrationId: 'fb', networkId: 'facebook', accountName: 'Maison Lune', text: 'Atelier ouvert samedi !', status: 'pending', publishAt: null, mediaIds: [], firstComment: null },
      { integrationId: 'li', networkId: 'linkedin', status: 'pending' },
    ]);
  });

  it('convertit l’heure locale du fuseau de l’utilisateur en UTC', () => {
    const r = run([post({ publish_at_local: '2026-10-28T09:00' })]);
    expect(r.ok && r.proposals[0]!.publishAt).toBe('2026-10-28T08:00:00.000Z');
  });

  it('garde le premier commentaire sur un réseau qui le publie, et les médias de la bibliothèque', () => {
    const r = run([post({ first_comment: '  Adresse en commentaire  ', media_ids: ['m1'] })]);
    expect(r.ok && r.proposals[0]).toMatchObject({ firstComment: 'Adresse en commentaire', mediaIds: ['m1'] });
  });

  it('accepte Instagram avec une image, et traite un commentaire vide comme absent', () => {
    const r = run([post({ channel_id: 'ig', media_ids: ['m1'], first_comment: '   ' })]);
    expect(r.ok && r.proposals[0]).toMatchObject({ networkId: 'instagram', firstComment: null });
  });
});

describe('parseProposeInput : règles par réseau', () => {
  const issues = (posts: unknown[], over?: Partial<ProposeContext>) => {
    const r = run(posts, over);
    return r.ok ? [] : r.issues;
  };

  it('refuse un texte au-dessus de la limite du réseau (X compte 280)', () => {
    const [issue] = issues([post({ channel_id: 'x', text: 'a'.repeat(281) })]);
    expect(issue).toContain('post 1 (X "Maison Lune X")');
    expect(issue).toContain('tooLong');
    expect(issue).toContain('"max":280');
  });

  it('accepte exactement la limite', () => {
    expect(run([post({ channel_id: 'x', text: 'a'.repeat(280) })]).ok).toBe(true);
  });

  it('refuse Instagram sans média, et un média trop large pour Instagram', () => {
    expect(issues([post({ channel_id: 'ig' })])[0]).toContain('needsMedia');
    expect(issues([post({ channel_id: 'ig', media_ids: ['m3'] })])[0]).toContain('mediaAspect');
  });

  it('refuse les médias là où le worker ne sait pas encore les publier', () => {
    expect(issues([post({ channel_id: 'x', media_ids: ['m1'] })])[0]).toContain('mediaNotYet');
  });

  it('refuse un premier commentaire sur un réseau qui ne le gère pas, ou trop long', () => {
    expect(issues([post({ channel_id: 'ig', media_ids: ['m1'], first_comment: 'salut' })])[0]).toContain('firstCommentUnsupported');
    expect(issues([post({ channel_id: 'x', first_comment: 'a'.repeat(281) })])[0]).toContain('firstCommentTooLong');
  });

  it('refuse une date passée ou à moins d’une minute, accepte la suivante', () => {
    expect(issues([post({ publish_at_local: '2026-10-27T10:00' })])[0]).toContain('pastDate'); // 9 h UTC : passée
    expect(issues([post({ publish_at_local: '2026-10-27T11:00' })])[0]).toContain('pastDate'); // 10 h UTC : maintenant
    expect(issues([post({ publish_at_local: '2026-10-27T11:30' })])).toEqual([]); // 10 h 30 UTC : dans une demi-heure
  });
});

describe('parseProposeInput : entrée non fiable', () => {
  const failure = (input: unknown, over?: Partial<ProposeContext>) => {
    const r = parseProposeInput(input, ctx(over));
    return r.ok ? [] : r.issues;
  };

  it('refuse ce qui n’a pas la forme attendue', () => {
    expect(failure(null)).toHaveLength(1);
    expect(failure({})).toHaveLength(1);
    expect(failure({ posts: [] })).toHaveLength(1);
    expect(failure({ posts: 'non' })).toHaveLength(1);
    expect(failure({ posts: ['texte'] })[0]).toContain('must be an object');
  });

  it('refuse un canal qui n’est pas parmi ceux que l’utilisateur a cochés', () => {
    expect(failure({ posts: [post({ channel_id: 'autre-org' })] })[0]).toContain('not one of the selected channels');
    expect(failure({ posts: [post({ channel_id: 'fb' })] }, { channels: [channel('li', 'linkedin', 'Camille')] })[0]).toContain('not one of the selected channels');
  });

  it('refuse un canal à reconnecter', () => {
    expect(failure({ posts: [post({ channel_id: 'old' })] })[0]).toContain('reconnected');
  });

  it('refuse un texte vide, un média inconnu, une date illisible', () => {
    expect(failure({ posts: [post({ text: '   ' })] })[0]).toContain('"text" is empty');
    expect(failure({ posts: [post({ media_ids: ['inconnu'] })] })[0]).toContain('unknown media id inconnu');
    expect(failure({ posts: [post({ publish_at_local: 'demain matin' })] })[0]).toContain('publish_at_local');
    expect(failure({ posts: [post({ media_ids: 'm1' })] })[0]).toContain('media_ids');
  });

  it('plafonne le nombre de publications d’un appel', () => {
    expect(failure({ posts: Array.from({ length: 9 }, () => post()) })[0]).toContain('at most 8');
  });

  it('rapporte toutes les erreurs d’un coup, pour que le modèle corrige en un seul tour', () => {
    const r = failure({ posts: [post({ channel_id: 'x', text: 'a'.repeat(300) }), post({ channel_id: 'ig' }), post()] });
    expect(r).toHaveLength(2);
  });
});

describe('mediaIdsOf', () => {
  it('liste les identifiants cités, sans doublon ni valeur étrangère', () => {
    expect(mediaIdsOf({ posts: [{ media_ids: ['a', 'b'] }, { media_ids: ['b', 3, null] }, 'x', { media_ids: 'a' }] })).toEqual(['a', 'b']);
    expect(mediaIdsOf(null)).toEqual([]);
    expect(mediaIdsOf({ posts: 4 })).toEqual([]);
  });
});

describe('describeError', () => {
  it('donne la clé sans préfixe et ses paramètres', () => {
    expect(describeError({ key: 'app.validation.tooLong', params: { network: 'X', length: 300, max: 280 } })).toBe('tooLong {"network":"X","length":300,"max":280}');
    expect(describeError({ key: 'app.validation.needDate' })).toBe('needDate');
  });
});

describe('sanitizeProposals', () => {
  const good = { id: 'p1', integrationId: 'fb', networkId: 'facebook', accountName: 'Maison Lune', text: 'Bonjour', firstComment: null, mediaIds: ['m1'], publishAt: '2026-10-28T08:00:00.000Z', status: 'draft' };

  it('garde une publication bien formée telle quelle', () => {
    expect(sanitizeProposals([good])).toEqual([good]);
  });

  it('écarte ce qui n’est pas exploitable, sans rien casser', () => {
    expect(sanitizeProposals('non')).toEqual([]);
    expect(sanitizeProposals([null, 'x', { ...good, id: 3 }, { ...good, networkId: 'myspace' }, { ...good, status: 'published' }, { ...good, text: 'a'.repeat(20_001) }, good])).toEqual([good]);
  });

  it('corrige les champs facultatifs abîmés au lieu d’écarter la publication', () => {
    expect(sanitizeProposals([{ ...good, publishAt: 'demain', mediaIds: ['m1', 4, null], firstComment: 7 }])[0]).toMatchObject({ publishAt: null, mediaIds: ['m1'], firstComment: null });
  });
});
