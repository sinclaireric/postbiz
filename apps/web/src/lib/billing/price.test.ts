import { describe, expect, it } from 'vitest';
import { CFA_PER_EUR, USD_PER_EUR_REFERENCE, usdPerEur } from './config.ts';
import { formatMoney, minorUnits, monthlyPrice, priceFor, usdEquivalent, usdToCfa, yearlySavings } from './price.ts';
import { regionOf } from './region.ts';

const R = USD_PER_EUR_REFERENCE;
const cfa = regionOf('CM');
const world = regionOf('FR');
const rdc = regionOf('CD');

describe('prix mensuels', () => {
  it('dollars hors Afrique : la grille de référence, sans rabais', () => {
    expect(monthlyPrice('standard', world, R)).toBe(19);
    expect(monthlyPrice('team', world, R)).toBe(39);
    expect(monthlyPrice('agency', world, R)).toBe(79);
  });

  it('francs CFA : conversion au taux de référence, moins 15 %, arrondi aux 500 F', () => {
    // 19 $ ÷ 1,1193 × 655,957 = 11 135 F → −15 % = 9 465 → 9 500
    expect(monthlyPrice('standard', cfa, R)).toBe(9500);
    expect(monthlyPrice('team', cfa, R)).toBe(19500);
    expect(monthlyPrice('agency', cfa, R)).toBe(39500);
  });

  it('la zone CEMAC (XAF) et la zone UEMOA (XOF) ont les mêmes montants', () => {
    for (const p of ['standard', 'team', 'agency'] as const) expect(monthlyPrice(p, regionOf('CM'), R)).toBe(monthlyPrice(p, regionOf('SN'), R));
  });

  it('la remise réelle reste proche de 15 % (l’arrondi aux 500 F coûte au plus 250 F)', () => {
    for (const p of ['standard', 'team', 'agency'] as const) {
      const brut = usdToCfa({ standard: 19, team: 39, agency: 79 }[p], R);
      const final = monthlyPrice(p, cfa, R);
      expect(Math.abs(final - brut * 0.85)).toBeLessThanOrEqual(250);
      expect(final).toBeLessThan(brut);
    }
  });

  it('RDC : dollars avec le même rabais de 15 %, à l’unité', () => {
    expect(monthlyPrice('standard', rdc, R)).toBe(16);
    expect(monthlyPrice('team', rdc, R)).toBe(33);
    expect(monthlyPrice('agency', rdc, R)).toBe(67);
  });

  it('suit le taux : un dollar plus fort rend le franc CFA moins cher', () => {
    expect(monthlyPrice('team', cfa, 1.3)).toBeLessThan(monthlyPrice('team', cfa, 1.0));
  });
});

describe('prix à l’année (12 mois, −20 %)', () => {
  it('francs CFA : le total est arrondi aux 500 F, le mensuel équivalent en découle', () => {
    expect(priceFor('standard', 'yearly', cfa, R)).toMatchObject({ currency: 'XAF', amount: 91000, yearlyAtMonthlyRate: 114000 });
    expect(priceFor('team', 'yearly', cfa, R).amount).toBe(187000);
    expect(priceFor('agency', 'yearly', cfa, R).amount).toBe(379000);
    expect(priceFor('standard', 'yearly', cfa, R).perMonth).toBeCloseTo(7583.33, 1);
  });

  it('dollars : total entier', () => {
    expect(priceFor('standard', 'yearly', world, R).amount).toBe(182);
    expect(priceFor('team', 'yearly', world, R).amount).toBe(374);
    expect(priceFor('agency', 'yearly', world, R).amount).toBe(758);
  });

  it('un mois : le montant est le prix mensuel', () => {
    expect(priceFor('team', 'monthly', cfa, R)).toMatchObject({ amount: 19500, perMonth: 19500, interval: 'monthly' });
  });

  it('l’économie de l’annuel est positive et égale à l’écart avec 12 mois au tarif mensuel', () => {
    const p = priceFor('standard', 'yearly', cfa, R);
    expect(yearlySavings(p)).toBe(114000 - 91000);
    expect(yearlySavings(priceFor('standard', 'monthly', cfa, R))).toBe(0);
  });

  it('le plus gros paiement prépayé reste sous le plafond du Gabon (500 000 F par dépôt)', () => {
    expect(priceFor('agency', 'yearly', regionOf('GA'), R).amount).toBeLessThan(500_000);
  });
});

describe('équivalents et unités', () => {
  it('équivalent en dollars', () => {
    expect(usdEquivalent(19, 'USD')).toBe(19);
    expect(usdEquivalent(CFA_PER_EUR, 'XOF', R)).toBeCloseTo(R, 2);
    expect(usdEquivalent(9500, 'XAF', R)).toBeCloseTo(16.21, 2);
    expect(() => usdEquivalent(1, 'EUR')).toThrow(/non prise en charge/);
  });

  it('unités de Stripe : centimes en dollars, francs entiers en CFA', () => {
    expect(minorUnits(19, 'USD')).toBe(1900);
    expect(minorUnits(19.99, 'USD')).toBe(1999);
    expect(minorUnits(9500, 'XAF')).toBe(9500);
    expect(minorUnits(91000, 'XOF')).toBe(91000);
    expect(() => minorUnits(1, 'EUR')).toThrow();
  });

  it('le taux peut être remplacé par l’environnement, dans des bornes raisonnables', () => {
    expect(usdPerEur({})).toBe(R);
    expect(usdPerEur({ BILLING_USD_PER_EUR: '1.2' })).toBe(1.2);
    expect(usdPerEur({ BILLING_USD_PER_EUR: '0' })).toBe(R);
    expect(usdPerEur({ BILLING_USD_PER_EUR: 'abc' })).toBe(R);
    expect(usdPerEur({ BILLING_USD_PER_EUR: '99' })).toBe(R);
  });

  it('formate le montant dans la monnaie', () => {
    expect(formatMoney('fr-FR', 9500, 'XAF').replace(/\s/g, ' ')).toMatch(/9 500/);
    expect(formatMoney('en-US', 19, 'USD')).toBe('$19');
    expect(formatMoney('en-US', 19.5, 'USD')).toBe('$19.50');
  });
});
