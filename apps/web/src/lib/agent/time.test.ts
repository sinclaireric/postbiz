import { describe, expect, it } from 'vitest';
import { describeNow, isValidTimeZone, localToUtc, utcToLocal } from './time';

describe('isValidTimeZone', () => {
  it('accepte un fuseau IANA et refuse le reste', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('x'.repeat(65))).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('localToUtc', () => {
  it('convertit l’heure d’hiver et l’heure d’été de Paris', () => {
    expect(localToUtc('2026-01-15T09:00', 'Europe/Paris')).toBe('2026-01-15T08:00:00.000Z');
    expect(localToUtc('2026-07-15T09:00', 'Europe/Paris')).toBe('2026-07-15T07:00:00.000Z');
  });

  it('gère un fuseau à l’ouest de Greenwich et un fuseau à demi-heure', () => {
    expect(localToUtc('2026-07-15T09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z');
    expect(localToUtc('2026-07-15T09:00', 'Asia/Kolkata')).toBe('2026-07-15T03:30:00.000Z');
  });

  it('tombe juste de part et d’autre du changement d’heure', () => {
    // Paris passe à l’heure d’été le 29 mars 2026 à 2 h (UTC+1 → UTC+2).
    expect(localToUtc('2026-03-29T01:30', 'Europe/Paris')).toBe('2026-03-29T00:30:00.000Z');
    expect(localToUtc('2026-03-29T03:30', 'Europe/Paris')).toBe('2026-03-29T01:30:00.000Z');
    // … et repasse à l’heure d’hiver le 25 octobre 2026 à 3 h.
    expect(localToUtc('2026-10-25T09:00', 'Europe/Paris')).toBe('2026-10-25T08:00:00.000Z');
  });

  it('refuse ce qui n’est pas une date', () => {
    expect(localToUtc('demain 9h', 'UTC')).toBeNull();
    expect(localToUtc('2026-02-31T09:00', 'UTC')).toBeNull();
    expect(localToUtc('2026-13-01T09:00', 'UTC')).toBeNull();
    expect(localToUtc('2026-01-01T24:00', 'UTC')).toBeNull();
    expect(localToUtc('2026-01-01 09:00', 'UTC')).toBeNull();
  });
});

describe('utcToLocal', () => {
  it('est la réciproque de localToUtc', () => {
    for (const [local, tz] of [['2026-07-15T09:00', 'Europe/Paris'], ['2026-01-15T23:45', 'America/New_York'], ['2026-10-25T09:00', 'Europe/Paris'], ['2026-07-15T09:00', 'Asia/Kolkata']] as const) {
      expect(utcToLocal(localToUtc(local, tz)!, tz)).toBe(local);
    }
  });

  it('passe minuit dans le bon sens', () => {
    expect(utcToLocal('2026-07-15T23:30:00Z', 'Europe/Paris')).toBe('2026-07-16T01:30');
  });
});

describe('describeNow', () => {
  it('donne le jour de la semaine et l’heure locale', () => {
    expect(describeNow(new Date('2026-10-27T13:05:00Z'), 'Europe/Paris')).toBe('Tuesday 2026-10-27 14:05');
  });
});
