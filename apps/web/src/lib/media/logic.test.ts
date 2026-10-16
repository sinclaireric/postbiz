import { describe, expect, it } from 'vitest';
import { MAX_MEDIA_BYTES, displayName, formatBytes, safeFileName, storagePath, validateMediaFile } from './logic';

describe('validateMediaFile', () => {
  it('accepte images et vidéos', () => {
    expect(validateMediaFile({ name: 'a.png', type: 'image/png', size: 10 })).toBeNull();
    expect(validateMediaFile({ name: 'a.mp4', type: 'video/mp4', size: MAX_MEDIA_BYTES })).toBeNull();
  });
  it('refuse les autres types, les fichiers vides et trop gros', () => {
    expect(validateMediaFile({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toMatch(/pas une image/);
    expect(validateMediaFile({ name: 'a.png', type: 'image/png', size: 0 })).toMatch(/vide/);
    expect(validateMediaFile({ name: 'a.mp4', type: 'video/mp4', size: MAX_MEDIA_BYTES + 1 })).toMatch(/1 Go/);
    expect(validateMediaFile({ name: 'x', type: '', size: 10 })).not.toBeNull();
  });
});

describe('safeFileName', () => {
  it('retire accents, espaces et caractères spéciaux', () => {
    expect(safeFileName('Ma photo été (1).JPG')).toBe('Ma-photo-ete-1.jpg');
  });
  it('neutralise les traversées de chemin', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeFileName('..\\..\\x.png')).toBe('x.png');
  });
  it('donne un nom par défaut quand il ne reste rien', () => {
    expect(safeFileName('???')).toBe('fichier');
  });
  it('tronque les noms très longs', () => {
    expect(safeFileName('a'.repeat(300) + '.mp4').length).toBeLessThanOrEqual(85);
  });
});

describe('chemins de stockage', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  it('respecte la convention {org}/{fichier}', () => {
    const p = storagePath('org-1', uuid, 'Ma photo.png');
    expect(p).toBe(`org-1/${uuid}-Ma-photo.png`);
    expect(p.split('/')).toHaveLength(2);
  });
  it('retrouve le nom d’affichage', () => expect(displayName(storagePath('org-1', uuid, 'Ma photo.png'))).toBe('Ma-photo.png'));
});

describe('formatBytes', () => {
  it('formate', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2 Ko');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5,0 Mo');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5 Go');
  });
});
