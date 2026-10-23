import { describe, expect, it } from 'vitest';
import { FIRST_COMMENT_RULES, supportsFirstComment, tightestLimit, validatePost } from './logic';

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

  it('compte la longueur comme le réseau : les émojis pèsent double sur X, pas ailleurs', () => {
    const emojis = '😀'.repeat(141); // 282 sur X
    expect(keys(validatePost({ content: emojis, networkIds: ['x'], publishAt: null, mode: 'draft', now }))).toEqual(['app.validation.tooLong']);
    expect(validatePost({ content: emojis, networkIds: ['linkedin'], publishAt: null, mode: 'draft', now })).toEqual([]);
  });

  it('un texte en gras Unicode compte pour un caractère par lettre hors X, deux sur X', () => {
    const bold = '𝗯'.repeat(150);
    expect(validatePost({ content: bold, networkIds: ['facebook', 'linkedin'], publishAt: null, mode: 'draft', now })).toEqual([]);
    expect(validatePost({ content: bold, networkIds: ['x'], publishAt: null, mode: 'draft', now })).toEqual([
      { key: 'app.validation.tooLong', params: { network: 'X', length: 300, max: 280 } },
    ]);
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

describe('premier commentaire', () => {
  const base = { content: 'Bonjour', publishAt: future, mode: 'schedule' as const, now };

  it('est pris en charge sur Facebook, LinkedIn (profil et Page) et X, pas sur Instagram, TikTok ni YouTube', () => {
    expect(Object.keys(FIRST_COMMENT_RULES).sort()).toEqual(['facebook', 'linkedin', 'linkedin_page', 'x']);
    expect(['facebook', 'linkedin', 'linkedin_page', 'x'].every((id) => supportsFirstComment(id as 'x'))).toBe(true);
    expect(['instagram', 'tiktok', 'youtube'].some((id) => supportsFirstComment(id as 'x'))).toBe(false);
  });

  it('une Page LinkedIn se publie comme LinkedIn : même limite de texte, texte seul accepté', () => {
    expect(validatePost({ ...base, networkIds: ['linkedin_page'], firstComment: 'Le lien est en commentaire.' })).toEqual([]);
    expect(validatePost({ ...base, content: 'a'.repeat(3_001), networkIds: ['linkedin_page'] })).not.toEqual([]);
  });

  it('accepte un commentaire sur un canal qui le permet', () => {
    expect(validatePost({ ...base, networkIds: ['facebook'], firstComment: 'Dites-nous ce que vous en pensez 👇' })).toEqual([]);
  });

  it('refuse un commentaire quand aucun canal choisi ne le permet, même pour un brouillon', () => {
    expect(keys(validatePost({ ...base, networkIds: ['instagram'], hasMedia: true, firstComment: 'Salut' }))).toEqual(['app.validation.firstCommentUnsupported']);
    expect(keys(validatePost({ ...base, mode: 'draft', networkIds: ['tiktok'], firstComment: 'Salut' }))).toEqual(['app.validation.firstCommentUnsupported']);
  });

  it('un canal sans prise en charge ne bloque pas les autres', () => {
    expect(validatePost({ ...base, networkIds: ['facebook', 'instagram'], hasMedia: true, firstComment: 'Salut' })).toEqual([]);
  });

  it('applique la limite de chaque réseau', () => {
    const text = 'a'.repeat(300);
    expect(validatePost({ ...base, networkIds: ['facebook', 'x', 'linkedin'], firstComment: text })).toEqual([
      { key: 'app.validation.firstCommentTooLong', params: { network: 'X', length: 300, max: 280 } },
    ]);
    expect(keys(validatePost({ ...base, networkIds: ['linkedin'], firstComment: 'a'.repeat(1_251) }))).toEqual(['app.validation.firstCommentTooLong']);
  });

  it('un commentaire vide ou fait d’espaces est ignoré', () => {
    expect(validatePost({ ...base, networkIds: ['instagram'], hasMedia: true, firstComment: '   ' })).toEqual([]);
  });
});

describe('médias d’une publication', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const future = '2026-10-22T10:00:00Z';
  const base = { content: '', publishAt: future, mode: 'schedule' as const, now };
  const img = (n: number) => Array.from({ length: n }, () => ({ kind: 'image' as const }));
  const keys = (r: ReturnType<typeof validatePost>) => r.map((e) => e.key.replace('app.validation.', ''));

  it('un média suffit à une publication sans texte, et satisfait un réseau qui en exige', () => {
    expect(keys(validatePost({ ...base, networkIds: ['instagram'] }))).toEqual(['needTextOrMedia', 'needsMedia']);
    expect(validatePost({ ...base, networkIds: ['instagram'], media: img(1) })).toEqual([]);
    expect(validatePost({ ...base, networkIds: ['instagram_standalone'], media: img(3) })).toEqual([]);
  });

  it('applique les limites de chaque réseau choisi', () => {
    expect(keys(validatePost({ ...base, networkIds: ['instagram', 'facebook'], media: img(11) }))).toEqual(['mediaTooMany', 'mediaTooMany']);
    expect(keys(validatePost({ ...base, networkIds: ['facebook'], media: [{ kind: 'image' }, { kind: 'video' }] }))).toEqual(['mediaMixed']);
  });

  it('refuse la programmation d’un média sur un réseau où le worker ne publie pas encore de médias', () => {
    expect(keys(validatePost({ ...base, content: 'Salut', networkIds: ['linkedin'], media: img(1) }))).toEqual(['mediaNotYet']);
  });

  it('un brouillon reste libre : les règles de médias ne s’appliquent qu’à la programmation', () => {
    expect(validatePost({ content: 'Brouillon', publishAt: null, mode: 'draft', networkIds: ['linkedin'], media: img(12), now })).toEqual([]);
  });
});
