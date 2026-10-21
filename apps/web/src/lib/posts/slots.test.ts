import { describe, expect, it } from 'vitest';
import { appendText, insertAt } from './edit';
import { inOneHour, nextSlot, tomorrowMorning } from './slots';

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m);

describe('créneaux de publication', () => {
  it('propose le premier créneau de la journée assez éloigné', () => {
    expect(nextSlot(at(7, 0))).toEqual(at(9, 0));
    expect(nextSlot(at(8, 31))).toEqual(at(12, 0)); // 9 h est à moins de 30 min
    expect(nextSlot(at(8, 29))).toEqual(at(9, 0));
    expect(nextSlot(at(13, 0))).toEqual(at(18, 0));
  });

  it('passe au lendemain matin quand il n’y a plus de créneau aujourd’hui', () => {
    expect(nextSlot(at(17, 45))).toEqual(at(9, 0, 22));
    expect(nextSlot(at(23, 0))).toEqual(at(9, 0, 22));
    expect(tomorrowMorning(at(15, 0))).toEqual(at(9, 0, 22));
  });

  it('passe correctement la fin du mois', () => {
    expect(tomorrowMorning(new Date(2026, 9, 31, 20, 0))).toEqual(new Date(2026, 10, 1, 9, 0));
  });

  it('« dans une heure » arrondit aux 5 minutes supérieures', () => {
    expect(inOneHour(at(10, 2))).toEqual(at(11, 5));
    expect(inOneHour(at(10, 55))).toEqual(at(11, 55));
    expect(inOneHour(at(10, 57))).toEqual(at(12, 0));
    expect(inOneHour(at(10, 0))).toEqual(at(11, 0));
  });
});

describe('édition du texte', () => {
  it('insère à la place de la sélection et place le curseur après', () => {
    expect(insertAt('Bonjour monde', 8, 13, '🌍')).toEqual({ value: 'Bonjour 🌍', cursor: 10 });
    expect(insertAt('abc', 1, 1, '#')).toEqual({ value: 'a#bc', cursor: 2 });
    expect(insertAt('abc', 99, 120, '!')).toEqual({ value: 'abc!', cursor: 4 });
  });

  it('ajoute à la suite après une ligne vide', () => {
    expect(appendText('Premier texte  \n', ' Suite ')).toBe('Premier texte\n\nSuite');
    expect(appendText('', ' Suite ')).toBe('Suite');
  });
});
