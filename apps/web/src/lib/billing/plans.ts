import type { MessageKey } from '@/i18n/types';

export const PLAN_IDS = ['free', 'standard', 'team', 'agency'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const PAID_PLAN_IDS = ['standard', 'team', 'agency'] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];
export type Interval = 'monthly' | 'yearly';

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
export const isPaidPlanId = (v: unknown): v is PaidPlanId => typeof v === 'string' && (PAID_PLAN_IDS as readonly string[]).includes(v);
export const isInterval = (v: unknown): v is Interval => v === 'monthly' || v === 'yearly';

/** Prix de référence : dollars par mois, facturé au mois. Tous les autres prix s'en déduisent (price.ts). */
export const USD_MONTHLY: Record<PaidPlanId, number> = { standard: 19, team: 39, agency: 79 };

/** Limites mesurées. Les mêmes valeurs sont dans la table `plan_limits` (migration 20261103000001_billing.sql) : un test vérifie qu'elles concordent. */
export const LIMIT_KEYS = [
  'channels', 'members', 'images_per_month', 'videos_per_month', 'ai_text_per_month', 'knowledge_files', 'knowledge_sites', 'storage_mb', 'analytics_days',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** `null` = illimité. */
export const PLAN_LIMITS: Record<PlanId, Record<LimitKey, number | null>> = {
  free: { channels: 3, members: 1, images_per_month: 5, videos_per_month: 0, ai_text_per_month: 30, knowledge_files: 5, knowledge_sites: 1, storage_mb: 500, analytics_days: 30 },
  standard: { channels: 5, members: 3, images_per_month: 30, videos_per_month: 3, ai_text_per_month: 300, knowledge_files: 20, knowledge_sites: 3, storage_mb: 5000, analytics_days: 90 },
  team: { channels: 30, members: 10, images_per_month: 150, videos_per_month: 15, ai_text_per_month: 1500, knowledge_files: 40, knowledge_sites: 5, storage_mb: 25000, analytics_days: 365 },
  agency: { channels: 100, members: 25, images_per_month: 400, videos_per_month: 40, ai_text_per_month: 5000, knowledge_files: 80, knowledge_sites: 20, storage_mb: 100000, analytics_days: 730 },
};

export const limitOf = (plan: PlanId, key: LimitKey): number | null => PLAN_LIMITS[plan][key];

export const planNameKey = (id: PlanId): MessageKey => `pricing.plans.${id}.name`;
export const planTaglineKey = (id: PlanId): MessageKey => `pricing.plans.${id}.tagline`;

export const planRank = (id: PlanId): number => PLAN_IDS.indexOf(id);

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type Provider = 'none' | 'stripe' | 'pawapay' | 'gift';

/** Ce que la page Facturation sait d'un abonnement (lignes de `subscriptions`, en camelCase). */
export interface Subscription {
  plan: PlanId;
  status: SubscriptionStatus;
  interval: Interval;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  provider: Provider;
  currency: string | null;
  country: string | null;
  giftNote: string | null;
}

/** L'offre applicable d'après les dates. Reflète `subscription_effective_plan` en base (mêmes cas, testés des deux côtés). */
export function effectivePlan(sub: Pick<Subscription, 'plan' | 'status' | 'trialEndsAt' | 'currentPeriodEnd' | 'graceEndsAt'> | null, now: Date = new Date()): PlanId {
  if (!sub) return 'free';
  const t = now.getTime();
  const after = (iso: string | null) => iso !== null && new Date(iso).getTime() > t;
  if (sub.status === 'trialing' && after(sub.trialEndsAt)) return sub.plan;
  if (sub.status === 'active' && (sub.currentPeriodEnd === null || after(sub.currentPeriodEnd))) return sub.plan;
  if ((sub.status === 'active' || sub.status === 'past_due') && after(sub.graceEndsAt)) return sub.plan;
  return 'free';
}

/** Pourquoi l'offre applicable est ce qu'elle est : sert à la bannière de la page Facturation. */
export type Phase = 'free' | 'trialing' | 'paying' | 'grace' | 'gift' | 'ended';

export function phaseOf(sub: Subscription | null, now: Date = new Date()): Phase {
  if (!sub) return 'free';
  const plan = effectivePlan(sub, now);
  if (plan === 'free') return sub.status === 'canceled' || sub.status === 'active' || sub.status === 'past_due' ? 'ended' : 'free';
  if (sub.status === 'trialing') return 'trialing';
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : null;
  if (end !== null && end <= now.getTime()) return 'grace';
  return sub.provider === 'gift' ? 'gift' : 'paying';
}
