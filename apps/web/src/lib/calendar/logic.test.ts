import { describe, expect, it } from 'vitest';
import type { PostItem } from '@/lib/data/types';
import {
  filterByChannel,
  addDays, dayKey, defaultTimeForDay, groupPosts, isPastSlot, monthGrid, rangeLabel, sameDay, shiftAnchor, slotKey, slotStart,
  startOfWeek, toLocalInputValue, weekDays,
} from './logic';

// Dates construites en heure locale : les tests passent quel que soit le fuseau de la machine.
const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min);

describe('semaines', () => {
  it('la semaine commence le lundi', () => {
    expect(dayKey(startOfWeek(d(2026, 10, 16)))).toBe('2026-10-12'); // vendredi
    expect(dayKey(startOfWeek(d(2026, 10, 18)))).toBe('2026-10-12'); // dimanche
    expect(dayKey(startOfWeek(d(2026, 10, 12)))).toBe('2026-10-12'); // lundi
  });
  it('7 jours, du lundi au dimanche', () => {
    expect(weekDays(d(2026, 10, 16)).map(dayKey)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  });
  it('addDays traverse les mois et les années', () => {
    expect(dayKey(addDays(d(2026, 12, 31), 1))).toBe('2027-01-01');
    expect(dayKey(addDays(d(2026, 3, 1), -1))).toBe('2026-02-28');
  });
  it('addDays reste correct au passage à l’heure d’été', () => {
    // 29/03/2027 : changement d'heure en Europe ; le jour calendaire doit avancer d'un, pas de 24 h exactes.
    expect(dayKey(addDays(d(2027, 3, 28, 12), 1))).toBe('2027-03-29');
  });
});

describe('mois', () => {
  it('couvre des semaines entières lundi → dimanche', () => {
    const grid = monthGrid(d(2026, 10, 16));
    expect(grid.length % 7).toBe(0);
    expect(grid[0]!.getDay()).toBe(1);
    expect(grid[grid.length - 1]!.getDay()).toBe(0);
    expect(dayKey(grid[0]!)).toBe('2026-09-28');
    expect(dayKey(grid[grid.length - 1]!)).toBe('2026-11-01');
  });
  it('février de 28 jours commençant un lundi tient en 4 lignes', () => {
    expect(monthGrid(d(2027, 2, 10))).toHaveLength(28); // 1er février 2027 = lundi
  });
  it('contient tous les jours du mois', () => {
    const keys = monthGrid(d(2026, 10, 1)).map(dayKey);
    for (let i = 1; i <= 31; i++) expect(keys).toContain(`2026-10-${String(i).padStart(2, '0')}`);
  });
});

describe('navigation', () => {
  it('avance et recule selon la vue', () => {
    expect(dayKey(shiftAnchor('day', d(2026, 10, 16), 1))).toBe('2026-10-17');
    expect(dayKey(shiftAnchor('week', d(2026, 10, 16), -1))).toBe('2026-10-09');
    expect(dayKey(shiftAnchor('month', d(2026, 10, 31), 1))).toBe('2026-11-01');
    expect(dayKey(shiftAnchor('month', d(2026, 1, 15), -1))).toBe('2025-12-01');
  });
  it('libellés de période', () => {
    expect(rangeLabel('week', d(2026, 10, 16))).toBe('12/10/2026 - 18/10/2026');
    expect(rangeLabel('day', d(2026, 10, 16))).toBe('16/10/2026');
    expect(rangeLabel('month', d(2026, 10, 16))).toMatch(/octobre 2026/);
    expect(rangeLabel('month', d(2026, 10, 16), 'en')).toMatch(/October 2026/);
  });
});

describe('créneaux', () => {
  const now = d(2026, 10, 16, 13, 30);
  it('l’heure en cours reste disponible, les précédentes non', () => {
    expect(isPastSlot(slotStart(d(2026, 10, 16), 13), now)).toBe(false);
    expect(isPastSlot(slotStart(d(2026, 10, 16), 12), now)).toBe(true);
    expect(isPastSlot(slotStart(d(2026, 10, 15), 23), now)).toBe(true);
    expect(isPastSlot(slotStart(d(2026, 10, 16), 14), now)).toBe(false);
  });
  it('formats', () => {
    expect(toLocalInputValue(d(2026, 10, 16, 9, 5))).toBe('2026-10-16T09:05');
    expect(slotKey(d(2026, 10, 16, 9, 59))).toBe('2026-10-16T09');
    expect(sameDay(d(2026, 10, 16, 1), d(2026, 10, 16, 23))).toBe(true);
    expect(sameDay(d(2026, 10, 16), d(2026, 10, 17))).toBe(false);
  });
  it('heure par défaut d’un jour cliqué dans le mois', () => {
    expect(toLocalInputValue(defaultTimeForDay(d(2026, 10, 20), now))).toBe('2026-10-20T09:00'); // futur : 9 h
    expect(toLocalInputValue(defaultTimeForDay(d(2026, 10, 16), now))).toBe('2026-10-16T14:00'); // aujourd'hui après 9 h : prochaine heure
    expect(toLocalInputValue(defaultTimeForDay(d(2026, 10, 16), d(2026, 10, 16, 7, 10)))).toBe('2026-10-16T09:00'); // aujourd'hui avant 9 h
  });
});

describe('groupPosts', () => {
  const post = (id: string, at: string | null): PostItem => ({
    id, groupId: id, integrationId: 'i1', networkId: 'facebook', accountName: 'x', content: id, publishAt: at, state: 'queued', error: null, releaseUrl: null,
    firstComment: null, firstCommentState: null, firstCommentError: null, media: [],
  });
  const a = d(2026, 10, 16, 9, 10).toISOString();
  const b = d(2026, 10, 16, 9, 50).toISOString();
  const c = d(2026, 10, 17, 18, 0).toISOString();

  it('par créneau : deux posts de la même heure sont ensemble, triés par date', () => {
    const m = groupPosts([post('b', b), post('a', a), post('c', c)], 'slot');
    expect(m.get('2026-10-16T09')!.map((p) => p.id)).toEqual(['a', 'b']);
    expect(m.get('2026-10-17T18')!.map((p) => p.id)).toEqual(['c']);
  });
  it('par jour', () => {
    expect(groupPosts([post('a', a), post('b', b), post('c', c)], 'day').get('2026-10-16')).toHaveLength(2);
  });
  it('ignore les publications sans date', () => {
    expect(groupPosts([post('x', null)], 'day').size).toBe(0);
  });
});

describe('filterByChannel', () => {
  const mk = (id: string, integrationId: string): PostItem => ({
    id, groupId: id, integrationId, networkId: 'facebook', accountName: 'x', content: id, publishAt: '2026-10-21T10:00:00Z', state: 'queued', error: null, releaseUrl: null,
    firstComment: null, firstCommentState: null, firstCommentError: null, media: [],
  });
  const posts = [mk('a', 'i1'), mk('b', 'i2'), mk('c', 'i1')];

  it('sans canal choisi : toutes les publications', () => {
    expect(filterByChannel(posts, null, ['i1', 'i2'])).toBe(posts);
  });

  it('un canal choisi : ses publications seulement, dans l’ordre', () => {
    expect(filterByChannel(posts, 'i1', ['i1', 'i2']).map((p) => p.id)).toEqual(['a', 'c']);
    expect(filterByChannel(posts, 'i2', ['i1', 'i2']).map((p) => p.id)).toEqual(['b']);
  });

  it('un canal qui n’existe plus (déconnecté) ne vide pas le calendrier', () => {
    expect(filterByChannel(posts, 'i9', ['i1', 'i2'])).toBe(posts);
  });

  it('un canal connecté sans publication donne une liste vide, c’est normal', () => {
    expect(filterByChannel(posts, 'i3', ['i1', 'i2', 'i3'])).toEqual([]);
  });
});
