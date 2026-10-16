import { describe, expect, it } from 'vitest';
import { tightestLimit, validatePost } from './logic';

const now = new Date('2026-10-16T12:00:00Z');
const future = '2026-10-17T09:00:00Z';
const keys = (e: { key: string }[]) => e.map((x) => x.key);

describe('validatePost', () => {
  it('exige au moins un canal', () => {
    expect(keys(validatePost({ content: 'x', networkIds: [], publishAt: null, mode: 'draft', now }))).toContain('app.validation.noChannel');
  });

  it('accepte un brouillon sans date ni texte', () => {
    expect(validatePost({ content: '', networkIds: ['x'], publishAt: null, mode: 'draft', now })).toEqual([]);
  });

  it('programmer exige texte et date', () => {
    const e = keys(validatePost({ content: ' ', networkIds: ['linkedin'], publishAt: null, mode: 'schedule', now }));
    expect(e).toEqual(expect.arrayContaining(['app.validation.needTextOrMedia', 'app.validation.needDate']));
  });

  it('refuse une date passée ou invalide', () => {
    expect(keys(validatePost({ content: 'x', networkIds: ['x'], publishAt: '2026-10-16T11:00:00Z', mode: 'schedule', now }))).toContain('app.validation.pastDate');
    expect(keys(validatePost({ content: 'x', networkIds: ['x'], publishAt: '2026-10-16T12:00:30Z', mode: 'schedule', now }))).toContain('app.validation.pastDate');
    expect(keys(validatePost({ content: 'x', networkIds: ['x'], publishAt: 'pas une date', mode: 'schedule', now }))).toContain('app.validation.invalidDate');
  });

  it('accepte une programmation valide', () => {
    expect(validatePost({ content: 'Bonjour', networkIds: ['linkedin', 'facebook'], publishAt: future, mode: 'schedule', now })).toEqual([]);
  });

  it('applique la limite de caractères de chaque réseau', () => {
    const text = 'a'.repeat(300);
    expect(validatePost({ content: text, networkIds: ['x', 'linkedin'], publishAt: future, mode: 'schedule', now })).toEqual([
      { key: 'app.validation.tooLong', params: { network: 'X', length: 300, max: 280 } },
    ]);
  });

  it('refuse Instagram, TikTok et YouTube sans média pour une publication programmée, pas pour un brouillon', () => {
    const e = validatePost({ content: 'x', networkIds: ['instagram', 'tiktok', 'youtube'], publishAt: future, mode: 'schedule', now });
    expect(e).toHaveLength(3);
    expect(e[0]).toEqual({ key: 'app.validation.needsMedia', params: { network: 'Instagram' } });
    expect(validatePost({ content: 'x', networkIds: ['instagram'], publishAt: null, mode: 'draft', now })).toEqual([]);
    expect(validatePost({ content: 'x', networkIds: ['instagram'], publishAt: future, mode: 'schedule', hasMedia: true, now })).toEqual([]);
  });

  it('ignore les doublons de canaux', () => {
    expect(validatePost({ content: 'a'.repeat(300), networkIds: ['x', 'x'], publishAt: null, mode: 'draft', now })).toHaveLength(1);
  });
});

describe('tightestLimit', () => {
  it('prend le plus petit plafond', () => {
    expect(tightestLimit(['facebook', 'x'])).toBe(280);
    expect(tightestLimit([])).toBeNull();
  });
});
