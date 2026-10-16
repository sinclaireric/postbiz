import { describe, expect, it } from 'vitest';
import { formatBytes, formatEuro, formatRelative } from './format';

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
