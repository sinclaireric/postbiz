import { describe, expect, it } from 'vitest';
import { PLANS, pricePerMonth, yearlySavings } from './pricing';

describe('tarifs', () => {
  it('le prix annuel est 20 % moins cher que le mensuel', () => {
    const pro = PLANS.find((p) => p.id === 'pro')!;
    expect(pricePerMonth(pro, 'monthly')).toBe(49);
    expect(pricePerMonth(pro, 'yearly')).toBe(39);
  });

  it('l’économie annuelle est cohérente avec les prix affichés', () => {
    for (const p of PLANS) {
      expect(yearlySavings(p)).toBe((pricePerMonth(p, 'monthly') - pricePerMonth(p, 'yearly')) * 12);
      expect(yearlySavings(p)).toBeGreaterThan(0);
    }
  });

  it('les offres montent en gamme', () => {
    const prices = PLANS.map((p) => p.monthly);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});
