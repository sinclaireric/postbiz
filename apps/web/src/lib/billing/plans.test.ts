import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIMIT_KEYS, PAID_PLAN_IDS, PLAN_IDS, PLAN_LIMITS, effectivePlan, limitOf, phaseOf, planRank, type Subscription } from './plans.ts';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '../../../../../supabase/migrations/20261103000001_billing.sql'), 'utf8');

const now = new Date('2026-11-01T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  plan: 'team', status: 'active', interval: 'monthly', trialEndsAt: null, currentPeriodEnd: at(10), graceEndsAt: null, cancelAtPeriodEnd: false,
  provider: 'pawapay', currency: 'XAF', country: 'CM', giftNote: null, ...over,
});

describe('limites par offre', () => {
  it('suit la grille annoncée : canaux 3 / 5 / 30 / 100', () => {
    expect(PLAN_IDS.map((p) => limitOf(p, 'channels'))).toEqual([3, 5, 30, 100]);
  });

  it('chaque offre définit chaque limite, et les offres montent en gamme', () => {
    for (const p of PLAN_IDS) for (const k of LIMIT_KEYS) expect(PLAN_LIMITS[p][k], `${p}.${k}`).not.toBeUndefined();
    for (const k of LIMIT_KEYS) {
      const values = PLAN_IDS.map((p) => PLAN_LIMITS[p][k] ?? Infinity);
      expect([...values].sort((a, b) => a - b), k).toEqual(values);
    }
    expect(PAID_PLAN_IDS.map(planRank)).toEqual([1, 2, 3]);
  });

  it('les valeurs de la table plan_limits (migration) sont celles affichées par le site', () => {
    const rows = [...migration.matchAll(/\('(free|standard|team|agency)',\s*'([a-z_]+)',\s*(\d+|null)\)/g)];
    expect(rows).toHaveLength(PLAN_IDS.length * LIMIT_KEYS.length);
    for (const [, plan, key, value] of rows) {
      expect(PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS][key as (typeof LIMIT_KEYS)[number]], `${plan}.${key}`).toBe(value === 'null' ? null : Number(value));
    }
  });
});

describe('offre applicable (reflet de subscription_effective_plan)', () => {
  it('sans abonnement : Gratuit', () => {
    expect(effectivePlan(null, now)).toBe('free');
  });

  it('essai en cours, puis terminé', () => {
    expect(effectivePlan(sub({ plan: 'standard', status: 'trialing', trialEndsAt: at(3), currentPeriodEnd: null }), now)).toBe('standard');
    expect(effectivePlan(sub({ plan: 'standard', status: 'trialing', trialEndsAt: at(-1), currentPeriodEnd: null }), now)).toBe('free');
  });

  it('abonnement actif, avec ou sans fin de période', () => {
    expect(effectivePlan(sub(), now)).toBe('team');
    expect(effectivePlan(sub({ currentPeriodEnd: null }), now)).toBe('team');
    expect(effectivePlan(sub({ currentPeriodEnd: at(-1) }), now)).toBe('free');
  });

  it('délai de grâce', () => {
    expect(effectivePlan(sub({ currentPeriodEnd: at(-1), graceEndsAt: at(6) }), now)).toBe('team');
    expect(effectivePlan(sub({ status: 'past_due', currentPeriodEnd: at(-1), graceEndsAt: at(6) }), now)).toBe('team');
    expect(effectivePlan(sub({ status: 'past_due', currentPeriodEnd: at(-1), graceEndsAt: at(-1) }), now)).toBe('free');
  });

  it('résilié : Gratuit, même avec une date de fin future', () => {
    expect(effectivePlan(sub({ status: 'canceled', currentPeriodEnd: at(20), graceEndsAt: at(20) }), now)).toBe('free');
  });
});

describe('phase affichée', () => {
  it('distingue gratuit, essai, abonné, grâce, cadeau et terminé', () => {
    expect(phaseOf(null, now)).toBe('free');
    expect(phaseOf(sub({ plan: 'standard', status: 'trialing', trialEndsAt: at(3), currentPeriodEnd: null }), now)).toBe('trialing');
    expect(phaseOf(sub(), now)).toBe('paying');
    expect(phaseOf(sub({ provider: 'gift' }), now)).toBe('gift');
    expect(phaseOf(sub({ currentPeriodEnd: at(-2), graceEndsAt: at(5) }), now)).toBe('grace');
    expect(phaseOf(sub({ currentPeriodEnd: at(-9), graceEndsAt: at(-2) }), now)).toBe('ended');
    expect(phaseOf(sub({ status: 'canceled' }), now)).toBe('ended');
    expect(phaseOf(sub({ plan: 'standard', status: 'trialing', trialEndsAt: at(-3), currentPeriodEnd: null }), now)).toBe('free');
  });
});
