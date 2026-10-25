import { describe, expect, it } from 'vitest';
import { formatUtc, nextPacificMidnight } from '../src/engine/quota.ts';

const next = (iso: string) => nextPacificMidnight(new Date(iso)).toISOString();

describe('nextPacificMidnight (renouvellement du quota YouTube)', () => {
  it('l’été, minuit à Los Angeles est 7 h UTC', () => {
    expect(next('2026-07-15T12:00:00Z')).toBe('2026-07-16T07:00:00.000Z'); // 5 h du matin à Los Angeles
    expect(next('2026-07-16T06:59:59Z')).toBe('2026-07-16T07:00:00.000Z'); // 23 h 59 : minuit dans une seconde
  });

  it('l’hiver, minuit à Los Angeles est 8 h UTC', () => {
    expect(next('2026-12-15T12:00:00Z')).toBe('2026-12-16T08:00:00.000Z');
    expect(next('2026-12-16T07:59:59Z')).toBe('2026-12-16T08:00:00.000Z');
  });

  it('à minuit pile, c’est le minuit suivant', () => {
    expect(next('2026-07-16T07:00:00Z')).toBe('2026-07-17T07:00:00.000Z');
    expect(next('2026-12-16T08:00:00Z')).toBe('2026-12-17T08:00:00.000Z');
  });

  it('la nuit du passage à l’heure d’été (8 mars 2026), minuit suivant est à l’heure d’été', () => {
    // 00 h 30 PST : le changement d'heure a lieu à 2 h, avant le minuit suivant.
    expect(next('2026-03-08T08:30:00Z')).toBe('2026-03-09T07:00:00.000Z');
    expect(next('2026-03-07T20:00:00Z')).toBe('2026-03-08T08:00:00.000Z'); // la veille, minuit est encore à l'heure d'hiver
  });

  it('la nuit du retour à l’heure d’hiver (1er novembre 2026), minuit suivant est à l’heure d’hiver', () => {
    expect(next('2026-11-01T07:30:00Z')).toBe('2026-11-02T08:00:00.000Z'); // 00 h 30 PDT
    expect(next('2026-10-31T20:00:00Z')).toBe('2026-11-01T07:00:00.000Z');
  });

  it('est toujours dans le futur, et à moins de 25 heures', () => {
    for (let h = 0; h < 24 * 400; h += 7) {
      const now = new Date(Date.UTC(2026, 0, 1) + h * 3_600_000 + 12 * 60_000);
      const at = nextPacificMidnight(now);
      expect(at.getTime()).toBeGreaterThan(now.getTime());
      expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(25 * 3_600_000);
    }
  });
});

describe('formatUtc', () => {
  it('écrit la date et l’heure en UTC', () => {
    expect(formatUtc(new Date('2026-10-25T07:10:00Z'))).toBe('25/10/2026 07:10 UTC');
    expect(formatUtc(new Date('2026-01-05T00:00:00Z'))).toBe('05/01/2026 00:00 UTC');
  });
});
