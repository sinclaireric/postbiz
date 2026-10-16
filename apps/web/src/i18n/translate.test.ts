import { describe, expect, it } from 'vitest';
import { createTranslator, lookup, splitRich } from './translate';

const fr = { hello: 'Bonjour {name}', nested: { deep: 'Profond' }, only_fr: 'Seulement en français', unread_one: '{count} non lu', unread_other: '{count} non lus', rich: 'Un <b>mot</b> et <link>un lien</link>.' };
const en = { hello: 'Hello {name}', nested: { deep: 'Deep' }, unread_one: '{count} unread', unread_other: '{count} unread' };

describe('lookup', () => {
  it('suit les clés pointées', () => {
    expect(lookup(fr, 'nested.deep')).toBe('Profond');
    expect(lookup(fr, 'nested.absent')).toBeUndefined();
    expect(lookup(fr, 'nested')).toBeUndefined(); // un nœud n'est pas un texte
    expect(lookup(fr, 'hello.x')).toBeUndefined();
  });
});

describe('createTranslator', () => {
  it('interpole les paramètres', () => {
    expect(createTranslator('en', [en])('hello', { name: 'Léa' })).toBe('Hello Léa');
  });
  it('garde un paramètre absent tel quel plutôt que d’écrire « undefined »', () => {
    expect(createTranslator('en', [en])('hello')).toBe('Hello {name}');
  });
  it('retombe sur la langue suivante quand une clé manque', () => {
    expect(createTranslator('en', [en, fr])('only_fr')).toBe('Seulement en français');
  });
  it('renvoie la clé quand elle n’existe nulle part (jamais d’exception)', () => {
    expect(createTranslator('en', [en, fr])('inexistante')).toBe('inexistante');
  });
  it('choisit la forme du pluriel selon la langue', () => {
    expect(createTranslator('fr', [fr])('unread', { count: 1 })).toBe('1 non lu');
    expect(createTranslator('fr', [fr])('unread', { count: 0 })).toBe('0 non lu'); // 0 est singulier en français
    expect(createTranslator('fr', [fr])('unread', { count: 2 })).toBe('2 non lus');
    expect(createTranslator('en', [en])('unread', { count: 0 })).toBe('0 unread');
  });
  it('gère les langues à pluriels multiples (russe, arabe)', () => {
    const ru = { n_one: '{count} файл', n_few: '{count} файла', n_many: '{count} файлов', n_other: '{count} файла' };
    const t = createTranslator('ru', [ru]);
    expect([1, 2, 5, 21, 22, 25].map((count) => t('n', { count }))).toEqual(['1 файл', '2 файла', '5 файлов', '21 файл', '22 файла', '25 файлов']);
    const ar = { n_zero: 'صفر', n_one: 'واحد', n_two: 'اثنان', n_few: 'قليل', n_many: 'كثير', n_other: 'آخر' };
    const a = createTranslator('ar', [ar]);
    expect([0, 1, 2, 3, 11, 100].map((count) => a('n', { count }))).toEqual(['صفر', 'واحد', 'اثنان', 'قليل', 'كثير', 'آخر']);
  });
  it('ne montre pas les balises dans la version texte, les garde dans raw()', () => {
    const t = createTranslator('fr', [fr]);
    expect(t('rich')).toBe('Un mot et un lien.');
    expect(t.raw('rich')).toBe('Un <b>mot</b> et <link>un lien</link>.');
  });
});

describe('splitRich', () => {
  it('découpe texte et balises', () => {
    expect(splitRich('Un <b>mot</b> et <link>un lien</link>.')).toEqual(['Un ', { tag: 'b', text: 'mot' }, ' et ', { tag: 'link', text: 'un lien' }, '.']);
  });
  it('renvoie le texte entier sans balise', () => {
    expect(splitRich('Rien à signaler')).toEqual(['Rien à signaler']);
  });
  it('ne confond pas deux balises différentes', () => {
    expect(splitRich('<a>x</a><b>y</b>')).toEqual([{ tag: 'a', text: 'x' }, { tag: 'b', text: 'y' }]);
  });
});
