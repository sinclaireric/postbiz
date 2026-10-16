export type Billing = 'monthly' | 'yearly';

export interface Plan {
  id: 'starter' | 'pro' | 'team';
  name: string;
  tagline: string;
  /** Prix mensuel en euros, facturé au mois. */
  monthly: number;
  popular?: boolean;
  features: string[];
  inheritsFrom?: string;
}

/** Remise appliquée au prix mensuel quand on paie à l'année. */
export const YEARLY_DISCOUNT = 0.2;

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Pour un créateur ou une petite marque qui démarre.',
    monthly: 19,
    features: ['3 canaux connectés', '1 membre', 'Planification et calendrier', 'Boîte de réception unifiée', 'Application mobile'],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Pour une équipe qui répond tous les jours.',
    monthly: 49,
    popular: true,
    inheritsFrom: 'Starter',
    features: ['10 canaux connectés', '5 membres', 'Assignation et notes internes', 'Réponses rapides', 'Notifications push', 'Recherche dans tous les messages'],
  },
  {
    id: 'team',
    name: 'Équipe',
    tagline: 'Pour une agence ou plusieurs marques.',
    monthly: 119,
    inheritsFrom: 'Pro',
    features: ['Canaux illimités', '15 membres', 'Rôles et permissions', 'Optimisation automatique des vidéos', 'Support prioritaire'],
  },
];

/** Prix affiché par mois. En annuel : remise de 20 %, arrondie à l'euro. */
export function pricePerMonth(plan: Pick<Plan, 'monthly'>, billing: Billing): number {
  return billing === 'yearly' ? Math.round(plan.monthly * (1 - YEARLY_DISCOUNT)) : plan.monthly;
}

/** Économie annuelle par rapport à 12 mois au tarif mensuel. */
export function yearlySavings(plan: Pick<Plan, 'monthly'>): number {
  return plan.monthly * 12 - pricePerMonth(plan, 'yearly') * 12;
}

export const formatEuro = (n: number) => `${n} €`;
