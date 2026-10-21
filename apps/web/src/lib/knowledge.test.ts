import { describe, expect, it } from 'vitest';
import { normalizeKnowledge, validateKnowledge } from './knowledge';

describe('fiches de la base de connaissance', () => {
  it('normalise : titre sur une ligne, contenu sans lignes vides en trop', () => {
    expect(normalizeKnowledge('  Ton   de\nla marque ', 'Ligne 1\r\n\r\n\r\n\r\nLigne 2  ')).toEqual({ title: 'Ton de la marque', content: 'Ligne 1\n\nLigne 2' });
    expect(normalizeKnowledge(null, undefined)).toEqual({ title: '', content: '' });
  });

  it('exige un titre et un contenu, dans les limites', () => {
    expect(validateKnowledge({ title: 'Ton', content: 'Tutoiement' })).toBeNull();
    expect(validateKnowledge({ title: '', content: 'x' })?.key).toBe('app.knowledge.errInvalid');
    expect(validateKnowledge({ title: 'x', content: '' })?.key).toBe('app.knowledge.errInvalid');
    expect(validateKnowledge({ title: 'x'.repeat(121), content: 'x' })?.key).toBe('app.knowledge.errInvalid');
    expect(validateKnowledge({ title: 'x', content: 'x'.repeat(20_001) })?.key).toBe('app.knowledge.errInvalid');
    expect(validateKnowledge({ title: 'x'.repeat(120), content: 'x'.repeat(20_000) })).toBeNull();
  });

  it('refuse une 101e fiche', () => {
    expect(validateKnowledge({ title: 'x', content: 'x' }, 99)).toBeNull();
    expect(validateKnowledge({ title: 'x', content: 'x' }, 100)).toEqual({ key: 'app.knowledge.errLimit', params: { max: 100 } });
  });
});
