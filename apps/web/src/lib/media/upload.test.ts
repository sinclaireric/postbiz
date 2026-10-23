import { describe, expect, it } from 'vitest';
import { fitWithin, mediaPaths, needsJpegRendition } from './upload';

describe('envoi de médias : calculs', () => {
  it('réduit pour tenir dans le carré demandé, sans agrandir ni déformer', () => {
    expect(fitWithin(4000, 2000, 480)).toEqual({ width: 480, height: 240 });
    expect(fitWithin(1080, 1350, 480)).toEqual({ width: 384, height: 480 });
    expect(fitWithin(300, 200, 480)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(1, 4000, 480)).toEqual({ width: 1, height: 480 });
  });

  it('seules les images qui ne sont pas des JPEG reçoivent une version JPEG (Instagram)', () => {
    expect(needsJpegRendition('image/png')).toBe(true);
    expect(needsJpegRendition('image/webp')).toBe(true);
    expect(needsJpegRendition('image/heic')).toBe(true);
    expect(needsJpegRendition('image/jpeg')).toBe(false);
    expect(needsJpegRendition('video/mp4')).toBe(false);
  });

  it('range le fichier, sa vignette et sa version JPEG dans le dossier de l’organisation', () => {
    const p = mediaPaths('org-1', 'abc', 'Été à Lyon (1).PNG');
    expect(p.original).toBe('org-1/abc-Ete-a-Lyon-1.png');
    expect(p.thumb).toBe('org-1/abc-thumb.jpg');
    expect(p.jpeg).toBe('org-1/abc-instagram.jpg');
    for (const path of Object.values(p)) expect(path.startsWith('org-1/')).toBe(true);
  });
});
