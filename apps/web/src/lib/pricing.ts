import type { MessageKey } from '@/i18n/types';

export type Billing = 'monthly' | 'yearly';
export type PlanId = 'starter' | 'pro' | 'team';

export interface Plan {
  id: PlanId;
  /** Prix mensuel en euros, facturé au mois. */
  monthly: number;
  popular?: boolean;
  /** Offre dont celle-ci reprend toutes les fonctionnalités. */
  inherits?: PlanId;
  /** Clés de message des fonctionnalités propres à l'offre. */
  features: MessageKey[];
  /** Parmi elles, celles qui ne sont pas encore disponibles (affichées « Bientôt »). À retirer d'ici quand elles existent. */
  soon?: MessageKey[];
}

/** Remise appliquée au prix mensuel quand on paie à l'année. */
export const YEARLY_DISCOUNT = 0.2;

export const PLANS: Plan[] = [
  {
    id: 'starter',
    monthly: 19,
    features: ['pricing.plans.starter.f1', 'pricing.plans.starter.f2', 'pricing.plans.starter.f3', 'pricing.plans.starter.f4', 'pricing.plans.starter.f5'],
    soon: ['pricing.plans.starter.f5'],
  },
  {
    id: 'pro',
    monthly: 49,
    popular: true,
    inherits: 'starter',
    features: ['pricing.plans.pro.f1', 'pricing.plans.pro.f2', 'pricing.plans.pro.f3', 'pricing.plans.pro.f4', 'pricing.plans.pro.f5', 'pricing.plans.pro.f6'],
    soon: ['pricing.plans.pro.f4', 'pricing.plans.pro.f5'],
  },
  {
    id: 'team',
    monthly: 119,
    inherits: 'pro',
    features: ['pricing.plans.team.f1', 'pricing.plans.team.f2', 'pricing.plans.team.f3', 'pricing.plans.team.f4', 'pricing.plans.team.f5'],
    soon: ['pricing.plans.team.f4'],
  },
];

export const planNameKey = (id: PlanId): MessageKey => `pricing.plans.${id}.name`;
export const planTaglineKey = (id: PlanId): MessageKey => `pricing.plans.${id}.tagline`;

/** Prix affiché par mois. En annuel : remise de 20 %, arrondie à l'euro. */
export function pricePerMonth(plan: Pick<Plan, 'monthly'>, billing: Billing): number {
  return billing === 'yearly' ? Math.round(plan.monthly * (1 - YEARLY_DISCOUNT)) : plan.monthly;
}

/** Économie annuelle par rapport à 12 mois au tarif mensuel. */
export function yearlySavings(plan: Pick<Plan, 'monthly'>): number {
  return plan.monthly * 12 - pricePerMonth(plan, 'yearly') * 12;
}
