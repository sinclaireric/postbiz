import { describe, expect, it } from 'vitest';
import { countLength, sliceAtLimit, xWeightedLength } from './length';

describe('longueur sur X (comptage pondéré)', () => {
  it('compte 1 par caractère latin, accentué compris', () => {
    expect(xWeightedLength('hello')).toBe(5);
    expect(xWeightedLength('Bonjour à tous, très bien !')).toBe(27);
    expect(xWeightedLength('a\nb')).toBe(3);
  });

  it('compte 2 pour les émojis, le chinois et le gras Unicode', () => {
    expect(xWeightedLength('😀')).toBe(2);
    expect(xWeightedLength('👨‍👩‍👧')).toBe(2);
    expect(xWeightedLength('❤️')).toBe(2);
    expect(xWeightedLength('你好')).toBe(4);
    expect(xWeightedLength('𝗯')).toBe(2);
  });

  it('compte un lien pour 23, quelle que soit sa longueur', () => {
    expect(xWeightedLength('https://exemple.fr/une/adresse/tres/tres/longue?avec=des&parametres=nombreux')).toBe(23);
    expect(xWeightedLength('Voir https://exemple.fr ok')).toBe(5 + 23 + 3);
  });
});

describe('longueur sur les autres réseaux', () => {
  it('compte les caractères, pas les unités UTF-16', () => {
    expect(countLength('linkedin', 'abc')).toBe(3);
    expect(countLength('linkedin', '𝗯𝗼𝗻')).toBe(3);
    expect(countLength('facebook', '😀')).toBe(1);
    expect(countLength('x', '𝗯𝗼𝗻')).toBe(6);
  });
});

describe('coupe à la limite', () => {
  it('ne coupe rien si ça passe', () => {
    expect(sliceAtLimit('x', 'court', 280)).toEqual(['court', '']);
    expect(sliceAtLimit('linkedin', 'court', 10)).toEqual(['court', '']);
  });

  it('coupe un texte trop long sur X au poids exact', () => {
    const [ok, over] = sliceAtLimit('x', 'a'.repeat(300), 280);
    expect(ok).toHaveLength(280);
    expect(over).toHaveLength(20);
    const [okEmoji, overEmoji] = sliceAtLimit('x', '😀'.repeat(200), 280);
    expect([...okEmoji]).toHaveLength(140);
    expect([...overEmoji]).toHaveLength(60);
  });

  it('un lien n’est jamais coupé en deux', () => {
    const url = 'https://exemple.fr/page';
    const [ok, over] = sliceAtLimit('x', `${'a'.repeat(260)} ${url}`, 280);
    expect(ok.endsWith(' ')).toBe(true);
    expect(over).toBe(url);
  });

  it('coupe en points de code sur les autres réseaux', () => {
    const [ok, over] = sliceAtLimit('linkedin', '𝗯'.repeat(5), 3);
    expect([...ok]).toHaveLength(3);
    expect([...over]).toHaveLength(2);
  });
});
