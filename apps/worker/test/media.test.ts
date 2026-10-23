import { describe, expect, it, vi } from 'vitest';
import { processPost } from '../src/engine/posts.ts';
import type { ResolvedMedia, SocialProvider } from '../src/providers/types.ts';
import { fakeDb, post } from './fakes.ts';
import { MediaUnavailableError, buildResolvedMedia, parseMediaRefs, type MediaRow } from '../src/engine/media.ts';

const row = (o: Partial<MediaRow> = {}): MediaRow => ({
  id: 'm1', org_id: 'org-1', bucket: 'media', path: 'org-1/a-photo.png', name: 'photo.png', mime_type: 'image/png', kind: 'image', size_bytes: 1000, width: 1080, height: 1350,
  duration_seconds: null, alt: 'Alt de la bibliothèque', thumbnail_path: 'org-1/a-thumb.jpg', normalized_path: 'org-1/a-instagram.jpg', ...o,
});
const urls = (...paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}?t=1`]));

describe('références de médias d’une publication', () => {
  it('lit les références dans l’ordre, avec leur texte alternatif', () => {
    expect(parseMediaRefs([{ media_id: 'a', type: 'image', alt: '  Un chat  ' }, { media_id: 'b', type: 'video' }, { media_id: 'c', alt: '' }])).toEqual([
      { id: 'a', alt: 'Un chat' }, { id: 'b', alt: null }, { id: 'c', alt: null },
    ]);
  });
  it('ignore ce qui n’a pas la bonne forme', () => {
    expect(parseMediaRefs(null)).toEqual([]);
    expect(parseMediaRefs({ media_id: 'a' })).toEqual([]);
    expect(parseMediaRefs([null, 3, {}, { media_id: 7 }, { media_id: '' }])).toEqual([]);
  });
});

describe('résolution des médias', () => {
  it('relie chaque média à ses URL signées : fichier, version JPEG, vignette', () => {
    const all = urls('org-1/a-photo.png', 'org-1/a-thumb.jpg', 'org-1/a-instagram.jpg');
    const [m] = buildResolvedMedia([{ id: 'm1', alt: null }], [row()], all, 'org-1');
    expect(m).toMatchObject({
      id: 'm1', kind: 'image', name: 'photo.png', mimeType: 'image/png', alt: 'Alt de la bibliothèque',
      url: 'https://signed/org-1/a-photo.png?t=1', jpegUrl: 'https://signed/org-1/a-instagram.jpg?t=1', thumbnailUrl: 'https://signed/org-1/a-thumb.jpg?t=1',
    });
  });

  it('le texte alternatif de la publication l’emporte sur celui de la bibliothèque', () => {
    const [m] = buildResolvedMedia([{ id: 'm1', alt: 'Alt du post' }], [row()], urls('org-1/a-photo.png'), 'org-1');
    expect(m!.alt).toBe('Alt du post');
  });

  it('garde l’ordre de la publication, pas celui de la base, et accepte la même image deux fois', () => {
    const rows = [row({ id: 'a', path: 'org-1/a.jpg', thumbnail_path: null, normalized_path: null }), row({ id: 'b', path: 'org-1/b.mp4', mime_type: 'video/mp4', kind: 'video', duration_seconds: '24.5', thumbnail_path: null, normalized_path: null })];
    const out = buildResolvedMedia([{ id: 'b', alt: null }, { id: 'a', alt: null }, { id: 'b', alt: null }], rows, urls('org-1/a.jpg', 'org-1/b.mp4'), 'org-1');
    expect(out.map((m) => m.id)).toEqual(['b', 'a', 'b']);
    expect(out[0]).toMatchObject({ kind: 'video', durationSeconds: 24.5, jpegUrl: null, thumbnailUrl: null });
  });

  it('un média disparu de la bibliothèque arrête tout, avant toute signature', () => {
    expect(() => buildResolvedMedia([{ id: 'zzz', alt: null }], [row()], new Map(), 'org-1', { dryRun: true })).toThrow(MediaUnavailableError);
  });

  it('refuse un média d’une autre organisation, d’un autre bucket ou hors du dossier de l’organisation', () => {
    const refs = [{ id: 'm1', alt: null }];
    expect(() => buildResolvedMedia(refs, [row({ org_id: 'org-2' })], urls('org-1/a-photo.png'), 'org-1')).toThrow(MediaUnavailableError);
    expect(() => buildResolvedMedia(refs, [row({ bucket: 'prive' })], urls('org-1/a-photo.png'), 'org-1')).toThrow(MediaUnavailableError);
    expect(() => buildResolvedMedia(refs, [row({ path: 'org-2/vole.png' })], urls('org-2/vole.png'), 'org-1')).toThrow(MediaUnavailableError);
    expect(() => buildResolvedMedia(refs, [row({ path: 'org-1/../org-2/vole.png' })], urls('org-1/../org-2/vole.png'), 'org-1')).toThrow(MediaUnavailableError);
  });

  it('ignore une vignette ou une version JPEG qui sortirait du dossier de l’organisation', () => {
    const [m] = buildResolvedMedia([{ id: 'm1', alt: null }], [row({ thumbnail_path: 'org-2/t.jpg', normalized_path: 'org-2/j.jpg' })], urls('org-1/a-photo.png', 'org-2/t.jpg', 'org-2/j.jpg'), 'org-1');
    expect(m).toMatchObject({ thumbnailUrl: null, jpegUrl: null });
  });

  it('signale un fichier absent du stockage', () => {
    expect(() => buildResolvedMedia([{ id: 'm1', alt: null }], [row()], new Map(), 'org-1')).toThrow(/introuvable dans le stockage/);
  });

  it('renvoie sans doublon les chemins à signer', () => {
    const paths = buildResolvedMedia([{ id: 'm1', alt: null }, { id: 'm1', alt: null }], [row()], new Map(), 'org-1', { dryRun: true });
    expect(paths.sort()).toEqual(['org-1/a-instagram.jpg', 'org-1/a-photo.png', 'org-1/a-thumb.jpg']);
  });
});

const resolved = (id: string, kind: 'image' | 'video' = 'image'): ResolvedMedia => ({
  id, kind, name: `${id}.jpg`, mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg', alt: '', url: `https://signed/${id}`, jpegUrl: null, thumbnailUrl: null,
  sizeBytes: 1, width: 1, height: 1, durationSeconds: null,
});

describe('publication d’un post avec médias', () => {
  const refs = [{ media_id: 'a', type: 'image' }, { media_id: 'b', type: 'video', alt: 'Visite' }];
  const withMedia = (supportsMedia = true) => {
    const publish = vi.fn(async () => [{ releaseId: 'R1', releaseUrl: null }]);
    const provider = { id: 'instagram', supportsThreads: false, supportsMedia, publish } as unknown as SocialProvider;
    return { provider, publish, registry: () => provider };
  };

  it('donne au fournisseur les médias résolus, dans l’ordre du post', async () => {
    const { registry, publish } = withMedia();
    const db = fakeDb({ resolveMedia: vi.fn(async () => [resolved('a'), resolved('b', 'video')]) });
    const out = await processPost({ db, providers: registry }, post({ media: refs }));
    expect(out.result).toBe('published');
    expect(db.resolveMedia).toHaveBeenCalledWith('org-1', refs);
    const input = (publish.mock.calls[0] as unknown as [{ posts: { media: ResolvedMedia[] }[] }])[0];
    expect(input.posts[0]!.media.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('un média disparu de la bibliothèque : « error » clair, rien n’est envoyé au réseau', async () => {
    const { registry, publish } = withMedia();
    const db = fakeDb({ resolveMedia: vi.fn(async () => { throw new MediaUnavailableError(); }) });
    const out = await processPost({ db, providers: registry }, post({ media: refs }));
    expect(out).toMatchObject({ result: 'error', message: expect.stringContaining('retirez-le') });
    expect(publish).not.toHaveBeenCalled();
    expect(db.markPostFailed).toHaveBeenCalledWith('post-1', 'error', expect.any(String));
  });

  it('une panne en préparant les médias reste un « error » (rien n’est parti), pas un « unknown »', async () => {
    const { registry, publish } = withMedia();
    const db = fakeDb({ resolveMedia: vi.fn(async () => { throw new Error('base indisponible'); }) });
    const out = await processPost({ db, providers: registry }, post({ media: refs }));
    expect(out.result).toBe('error');
    expect(out.message).toContain('Rien n’a été publié');
    expect(publish).not.toHaveBeenCalled();
  });

  it('un réseau qui ne publie pas encore de médias refuse sans toucher à la bibliothèque', async () => {
    const { registry, publish } = withMedia(false);
    const db = fakeDb();
    const out = await processPost({ db, providers: registry }, post({ media: refs }));
    expect(out.result).toBe('error');
    expect(db.resolveMedia).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
