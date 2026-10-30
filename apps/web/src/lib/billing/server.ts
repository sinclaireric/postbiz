import { createClient as createAdminClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { isDemo, supabaseUrl } from '@/lib/supabase/env';
import type { AppContext } from '@/lib/data/types';
import { demoBilling, type PaymentView } from './demo.ts';
import { REGION_COOKIE, resolveCountry, type CountrySource } from './geo.ts';
import { getActiveCountries, pawapayConfig, type PawapayConfig } from './pawapay.ts';
import {
  LIMIT_KEYS, PLAN_LIMITS, effectivePlan, isPlanId, phaseOf, type Interval, type LimitKey, type Phase, type PlanId, type Provider, type Subscription,
} from './plans.ts';
import { MOBILE_MONEY_FALLBACK, regionOf, type Region } from './region.ts';
import type { BillingStore } from './service.ts';
import { createSupabaseBillingStore } from './store.ts';
import { stripeConfig, type StripeConfig } from './stripe.ts';

/** Client de service (côté serveur seulement) ; `null` si la clé de service n'est pas configurée. */
function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) return null;
  return createAdminClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function billingStore(): BillingStore | null {
  const admin = serviceClient();
  return admin ? createSupabaseBillingStore(admin) : null;
}

export function serviceBillingClient() {
  return serviceClient();
}

export interface ProviderConfigs {
  stripe: StripeConfig | null;
  pawapay: PawapayConfig | null;
}
export const providerConfigs = (): ProviderConfigs => ({ stripe: stripeConfig(), pawapay: pawapayConfig() });

/** Pays où le mobile money est actif : la configuration de PawaPay si on peut la lire, sinon la liste par défaut. */
export async function mobileMoneyCountries(pawapay: PawapayConfig | null = pawapayConfig()): Promise<readonly string[]> {
  if (!pawapay) return MOBILE_MONEY_FALLBACK;
  const live = await getActiveCountries(pawapay);
  return live ? live.map((c) => c.country) : MOBILE_MONEY_FALLBACK;
}

export interface Visitor {
  region: Region;
  /** Pays tel que le visiteur l'a choisi ou tel qu'on l'a détecté ; « ZZ » = autre pays choisi. */
  country: string | null;
  source: CountrySource;
}

/** Pays et région de prix du visiteur : son choix, sinon l'hébergeur, sinon l'adresse IP. Ne lève jamais. */
export async function visitorRegion(): Promise<Visitor> {
  try {
    const [c, h] = await Promise.all([cookies(), headers()]);
    const r = await resolveCountry({ cookie: c.get(REGION_COOKIE)?.value, headers: h });
    return { region: regionOf(r.country === 'ZZ' ? null : r.country), country: r.country, source: r.source };
  } catch {
    return { region: regionOf(null), country: null, source: 'none' };
  }
}

/** La facturation est-elle activée (sinon : bêta gratuite, aucune limite, aucun paiement) ? Lisible sans être connecté. */
export async function billingEnabled(): Promise<boolean> {
  if (isDemo) return true;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc('billing_enabled');
    return data === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- page Facturation

export interface BillingView {
  enabled: boolean;
  demo: boolean;
  /** Offre réellement applicable aujourd'hui. */
  plan: PlanId;
  phase: Phase;
  subscription: Subscription | null;
  stripeCustomerId: string | null;
  usage: Partial<Record<LimitKey, number>>;
  limits: Record<LimitKey, number | null>;
  payments: PaymentView[];
  canManage: boolean;
  methods: { card: boolean; mobileMoney: boolean };
}

type SubRow = {
  plan: string; status: Subscription['status']; billing_interval: Interval; trial_ends_at: string | null; current_period_end: string | null; grace_ends_at: string | null;
  cancel_at_period_end: boolean; provider: Provider; currency: string | null; country: string | null; gift_note: string | null; stripe_customer_id: string | null;
};

const toSubscription = (r: SubRow): Subscription => ({
  plan: isPlanId(r.plan) ? r.plan : 'free', status: r.status, interval: r.billing_interval, trialEndsAt: r.trial_ends_at, currentPeriodEnd: r.current_period_end,
  graceEndsAt: r.grace_ends_at, cancelAtPeriodEnd: r.cancel_at_period_end, provider: r.provider, currency: r.currency, country: r.country, giftNote: r.gift_note,
});

export async function loadBillingView(ctx: AppContext): Promise<BillingView> {
  const cfg = providerConfigs();
  const canManage = ctx.org.role === 'admin';
  if (ctx.mode === 'demo') {
    const b = demoBilling(ctx.org.id);
    return {
      enabled: true, demo: true, plan: effectivePlan(b.subscription), phase: phaseOf(b.subscription), subscription: b.subscription, stripeCustomerId: null,
      usage: { channels: 4, members: 2, images_per_month: 3, videos_per_month: 0, ai_text_per_month: 12, storage_mb: 38 }, limits: PLAN_LIMITS[effectivePlan(b.subscription)],
      payments: b.payments, canManage, methods: { card: true, mobileMoney: true },
    };
  }

  const supabase = await createClient();
  const [usageRes, subRes, payRes, enabledRes] = await Promise.all([
    supabase.rpc('org_usage', { p_org: ctx.org.id }),
    supabase.from('subscriptions')
      .select('plan, status, billing_interval, trial_ends_at, current_period_end, grace_ends_at, cancel_at_period_end, provider, currency, country, gift_note, stripe_customer_id')
      .eq('org_id', ctx.org.id).maybeSingle(),
    supabase.from('payments').select('id, created_at, provider, plan, months, amount, currency, status').eq('org_id', ctx.org.id).order('created_at', { ascending: false }).limit(20),
    supabase.rpc('billing_enabled'),
  ]);
  const row = (subRes.data ?? null) as SubRow | null;
  const subscription = row ? toSubscription(row) : null;
  const u = (usageRes.data ?? {}) as { plan?: string; usage?: Record<string, unknown>; limits?: Record<string, unknown> };
  const plan = isPlanId(u.plan) ? u.plan : effectivePlan(subscription);
  const limits = { ...PLAN_LIMITS[plan] };
  for (const k of LIMIT_KEYS) if (u.limits && k in u.limits) limits[k] = u.limits[k] === null ? null : Number(u.limits[k]);
  const usage: Partial<Record<LimitKey, number>> = {};
  for (const k of LIMIT_KEYS) if (u.usage && Number.isFinite(Number(u.usage[k]))) usage[k] = Number(u.usage[k]);

  const countries = await mobileMoneyCountries(cfg.pawapay);
  return {
    enabled: enabledRes.data === true, demo: false, plan, phase: phaseOf(subscription), subscription, stripeCustomerId: row?.stripe_customer_id ?? null, usage, limits,
    payments: ((payRes.data ?? []) as { id: string; created_at: string; provider: PaymentView['provider']; plan: PaymentView['plan']; months: number; amount: string | number; currency: string; status: PaymentView['status'] }[])
      .map((p) => ({ id: p.id, createdAt: p.created_at, provider: p.provider, plan: p.plan, months: p.months, amount: Number(p.amount), currency: p.currency, status: p.status })),
    canManage,
    methods: { card: cfg.stripe !== null, mobileMoney: cfg.pawapay !== null && countries.length > 0 && billingStore() !== null },
  };
}
