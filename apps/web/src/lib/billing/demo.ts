import { PREPAID_GRACE_DAYS } from './config.ts';
import { priceFor } from './price.ts';
import type { Interval, PaidPlanId, Provider, Subscription } from './plans.ts';
import { regionOf } from './region.ts';

/**
 * Facturation du mode démo (sans Supabase) : un abonnement et des paiements gardés en mémoire du serveur, par espace de travail. Aucun fournisseur de
 * paiement n'est contacté et rien n'est débité : le « paiement » s'applique immédiatement. Perdu au redémarrage du serveur, comme le reste de la démo.
 */

export interface PaymentView {
  id: string;
  createdAt: string;
  provider: Exclude<Provider, 'none'>;
  plan: PaidPlanId;
  months: number;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
}

interface DemoBilling {
  subscription: Subscription;
  payments: PaymentView[];
}

const store = ((globalThis as { __postbizDemoBilling?: Map<string, DemoBilling> }).__postbizDemoBilling ??= new Map());
const DAY = 86_400_000;

function fresh(now: Date): DemoBilling {
  return {
    subscription: {
      plan: 'standard', status: 'trialing', interval: 'monthly', trialEndsAt: new Date(now.getTime() + 9 * DAY).toISOString(), currentPeriodEnd: null, graceEndsAt: null,
      cancelAtPeriodEnd: false, provider: 'none', currency: null, country: null, giftNote: null,
    },
    payments: [],
  };
}

export function demoBilling(orgId: string, now: Date = new Date()): DemoBilling {
  let b = store.get(orgId);
  if (!b) store.set(orgId, (b = fresh(now)));
  return b;
}

/** « Paie » une offre en démonstration : mêmes règles de période que la base (prolonge la même offre, sinon repart de maintenant). */
export function demoPay(orgId: string, plan: PaidPlanId, interval: Interval, method: 'card' | 'mobile_money', country: string | null, now: Date = new Date()): PaymentView {
  const b = demoBilling(orgId, now);
  const region = regionOf(country);
  const price = priceFor(plan, interval, region);
  const months = interval === 'yearly' ? 12 : 1;
  const s = b.subscription;
  const sameLive = s.status === 'active' && s.plan === plan && s.currentPeriodEnd !== null && new Date(s.currentPeriodEnd).getTime() > now.getTime();
  const start = sameLive ? new Date(s.currentPeriodEnd!) : now;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  const provider = method === 'card' ? 'stripe' : 'pawapay';
  b.subscription = {
    ...s, plan, status: 'active', interval, currentPeriodEnd: end.toISOString(), cancelAtPeriodEnd: false, provider,
    graceEndsAt: new Date(end.getTime() + (method === 'card' ? 3 : PREPAID_GRACE_DAYS) * DAY).toISOString(), currency: price.currency, country: region.country, giftNote: null,
  };
  const payment: PaymentView = { id: `demo-${b.payments.length + 1}`, createdAt: now.toISOString(), provider, plan, months, amount: price.amount, currency: price.currency, status: 'succeeded' };
  b.payments = [payment, ...b.payments];
  return payment;
}

/** Annulation en démonstration : l'offre reste jusqu'à la fin de la période (comme chez Stripe). */
export function demoCancel(orgId: string): void {
  const b = demoBilling(orgId);
  if (b.subscription.status === 'active') b.subscription = { ...b.subscription, cancelAtPeriodEnd: true };
}
