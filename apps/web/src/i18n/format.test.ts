import { describe, expect, it } from 'vitest';
import { formatArticleDate, formatBytes, formatEuro, formatRelative } from './format';

const NOW = new Date('2026-10-16T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('formatRelative', () => {
  it('formate dans la langue', () => {
    expect(formatRelative('en', ago(5 * 60_000), NOW)).toMatch(/5/);
    expect(formatRelative('fr', ago(30 * 3_600_000), NOW)).toBe('hier');
    expect(formatRelative('en', ago(30 * 3_600_000), NOW)).toBe('yesterday');
    expect(formatRelative('de', ago(30 * 3_600_000), NOW)).toBe('gestern');
  });
  it('au-delà de deux jours, affiche une date courte', () => {
    expect(formatRelative('en', ago(5 * 86_400_000), NOW)).toMatch(/Oct/);
  });
  it('« à l’instant » sous la minute', () => {
    expect(formatRelative('en', ago(10_000), NOW)).toMatch(/now|0/);
  });
  it('une date plus récente que l’heure donnée (horloge du navigateur en retard) se lit « maintenant », jamais en négatif', () => {
    expect(formatRelative('fr', new Date(NOW.getTime() + 40_000).toISOString(), NOW, 'long')).toBe('maintenant');
    expect(formatRelative('en', new Date(NOW.getTime() + 40_000).toISOString(), NOW, 'long')).toBe('now');
  });
  it('le style long donne une phrase : « il y a 5 minutes », « 5 minutes ago »', () => {
    expect(formatRelative('fr', ago(5 * 60_000), NOW, 'long')).toBe('il y a 5 minutes');
    expect(formatRelative('en', ago(5 * 60_000), NOW, 'long')).toBe('5 minutes ago');
    expect(formatRelative('fr', ago(3 * 3_600_000), NOW, 'long')).toBe('il y a 3 heures');
  });
});

describe('formatBytes', () => {
  const units = { b: 'B', kb: 'KB', mb: 'MB', gb: 'GB' };
  it('utilise le séparateur décimal de la langue', () => {
    expect(formatBytes('en', 5 * 1024 ** 2, units)).toBe('5.0 MB');
    expect(formatBytes('fr', 5 * 1024 ** 2, { b: 'o', kb: 'Ko', mb: 'Mo', gb: 'Go' })).toMatch(/^5,0\s+Mo$/);
    expect(formatBytes('en', 512, units)).toBe('512 B');
    expect(formatBytes('en', 2048, units)).toBe('2 KB');
  });
});

describe('formatEuro', () => {
  it('formate la monnaie selon la langue', () => {
    expect(formatEuro('en', 49)).toMatch(/€49/);
    expect(formatEuro('fr', 49)).toMatch(/49\s€/);
    expect(formatEuro('de', 49)).toMatch(/49\s€/);
  });
});

describe('formatArticleDate', () => {
  it('formate le jour dans la langue, sans décalage de fuseau', () => {
    expect(formatArticleDate('en', '2026-10-01')).toBe('Oct 1, 2026');
    expect(formatArticleDate('fr', '2026-10-01')).toBe('1 oct. 2026');
    expect(formatArticleDate('de', '2026-01-01')).toMatch(/01\.01\.2026|1\. Jan\.? 2026/);
  });
});
