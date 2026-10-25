import { describe, expect, it } from 'vitest';
import { queryTerms } from './terms';

describe('queryTerms : les mots d’une question qui servent à chercher', () => {
  it('garde les mots du sujet, en minuscules, sans les mots courants', () => {
    expect(queryTerms('Quels sont vos horaires d’ouverture le dimanche ?')).toEqual(['horaires', 'ouverture', 'dimanche']);
    expect(queryTerms('What time do you open on Sunday?')).toEqual(['time', 'open', 'sunday']);
    expect(queryTerms('¿Cuándo abren los domingos?')).toEqual(['cuándo', 'abren', 'domingos']);
  });

  it('garde les nombres (un prix, une heure) même courts, et écarte les mots d’une ou deux lettres', () => {
    expect(queryTerms('Livraison offerte dès 60 € ? Ouvert à 10 h')).toEqual(['livraison', 'offerte', 'dès', '60', 'ouvert', '10']);
  });

  it('sans doublon, et ignore la ponctuation et les accents d’un mot en gardant le mot intact', () => {
    expect(queryTerms('Garantie, garantie... GARANTIE !')).toEqual(['garantie']);
    expect(queryTerms('réservation-annulation')).toEqual(['réservation', 'annulation']);
  });

  it('au plus douze mots : les plus longs, dans l’ordre de la question', () => {
    const q = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar';
    const terms = queryTerms(q);
    expect(terms).toHaveLength(12);
    // Les trois plus courts (« echo », « golf », « kilo », « lima », « mike » : 4 lettres) laissent la place aux plus longs.
    expect(terms).toContain('charlie');
    expect(terms).toContain('november');
    expect(terms.indexOf('charlie')).toBeLessThan(terms.indexOf('november'));
  });

  it('rien d’exploitable : aucun mot (japonais, question vide, mots courants seuls)', () => {
    expect(queryTerms('')).toEqual([]);
    expect(queryTerms('   ')).toEqual([]);
    expect(queryTerms('le la et de')).toEqual([]);
    expect(queryTerms('の ? !')).toEqual([]);
  });

  it('un très long nombre n’est pas un mot de recherche', () => {
    expect(queryTerms(`commande ${'1'.repeat(40)}`)).toEqual(['commande']);
  });
});
