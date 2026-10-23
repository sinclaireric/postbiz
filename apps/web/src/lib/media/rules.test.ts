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
