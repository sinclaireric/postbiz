import { describe, expect, it } from 'vitest';
import { kindOfMime, MEDIA_RULES, validateMedia } from './rules';

const img = (n: number) => Array.from({ length: n }, () => ({ kind: 'image' as const }));
const vid = (n: number) => Array.from({ length: n }, () => ({ kind: 'video' as const }));
const keys = (r: ReturnType<typeof validateMedia>) => r.map((e) => e.key.replace('app.validation.', ''));

describe('règles de médias par réseau', () => {
  it('sans média, rien à valider', () => {
    expect(validateMedia('instagram', [])).toEqual([]);
    expect(validateMedia('linkedin', [])).toEqual([]);
  });

  it('Instagram : un média ou un carrousel de 10 images et vidéos mélangées', () => {
    expect(validateMedia('instagram', img(1))).toEqual([]);
    expect(validateMedia('instagram', vid(1))).toEqual([]);
    expect(validateMedia('instagram', [...img(6), ...vid(4)])).toEqual([]);
    expect(validateMedia('instagram_standalone', img(10))).toEqual([]);
    expect(keys(validateMedia('instagram', img(11)))).toEqual(['mediaTooMany']);
  });

  it('Facebook : 10 photos, ou une vidéo seule, jamais les deux', () => {
    expect(validateMedia('facebook', img(10))).toEqual([]);
    expect(validateMedia('facebook', vid(1))).toEqual([]);
    expect(keys(validateMedia('facebook', vid(2)))).toEqual(['mediaTooManyVideos']);
    expect(keys(validateMedia('facebook', [...img(2), ...vid(1)]))).toEqual(['mediaMixed']);
    expect(keys(validateMedia('facebook', img(11)))).toEqual(['mediaTooMany']);
  });

  it('TikTok et YouTube : une vidéo, pas d’image', () => {
    for (const n of ['tiktok', 'youtube'] as const) {
      expect(keys(validateMedia(n, vid(1)))).toEqual(['mediaNotYet']); // pas encore publiable
      expect(keys(validateMedia(n, img(1)))).toEqual(['mediaNotYet', 'mediaNoImages']);
    }
  });

  it('les réseaux dont le worker ne publie pas encore de médias refusent la programmation avec un message clair', () => {
    for (const n of ['x', 'linkedin', 'linkedin_page'] as const) expect(keys(validateMedia(n, img(1)))).toEqual(['mediaNotYet']);
    for (const n of ['facebook', 'instagram', 'instagram_standalone'] as const) expect(MEDIA_RULES[n].publishable).toBe(true);
  });

  it('donne le nom du réseau et la limite dans les paramètres', () => {
    const [e] = validateMedia('instagram', img(12));
    expect(e).toMatchObject({ key: 'app.validation.mediaTooMany', params: { network: 'Instagram', max: 10 } });
  });

  it('type MIME → image ou vidéo', () => {
    expect(kindOfMime('video/mp4')).toBe('video');
    expect(kindOfMime('image/png')).toBe('image');
    expect(kindOfMime(null)).toBe('image');
  });
});

describe('format des images Instagram', () => {
  const photo = (width: number, height: number) => [{ kind: 'image' as const, width, height, name: 'photo.png' }];
  const keys = (r: ReturnType<typeof validateMedia>) => r.map((e) => e.key.replace('app.validation.', ''));

  it('accepte les rapports de 4:5 à 1,91:1', () => {
    for (const [w, h] of [[1080, 1350], [1080, 1080], [1080, 566], [800, 1000], [1910, 1000]] as const) expect(validateMedia('instagram', photo(w, h))).toEqual([]);
  });

  it('refuse une image trop haute ou trop large, en nommant le fichier', () => {
    expect(keys(validateMedia('instagram', photo(1000, 1500)))).toEqual(['mediaAspect']);
    expect(keys(validateMedia('instagram_standalone', photo(2000, 600)))).toEqual(['mediaAspect']);
    expect(validateMedia('instagram', photo(212, 92))[0]).toMatchObject({ key: 'app.validation.mediaAspect', params: { network: 'Instagram', name: 'photo.png' } });
  });

  it('refuse une image de moins de 320 pixels de large', () => {
    expect(keys(validateMedia('instagram', photo(300, 300)))).toEqual(['mediaTooSmall']);
    expect(validateMedia('instagram', photo(320, 320))).toEqual([]);
  });

  it('ne dit rien quand les dimensions sont inconnues, pour les vidéos, et pour les autres réseaux', () => {
    expect(validateMedia('instagram', [{ kind: 'image' }])).toEqual([]);
    expect(validateMedia('instagram', [{ kind: 'video', width: 100, height: 900 }])).toEqual([]);
    expect(keys(validateMedia('facebook', photo(212, 92)))).toEqual([]);
  });
});
