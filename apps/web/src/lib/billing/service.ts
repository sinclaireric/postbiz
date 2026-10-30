import { DEPOSIT_PENDING_MINUTES } from './config.ts';
import { buildPaymentPageBody, createPaymentPage, getDeposit, type PawapayConfig } from './pawapay.ts';
import { minorUnits, priceFor, usdEquivalent } from './price.ts';
import { isInterval, isPaidPlanId, type Interval, type PaidPlanId } from './plans.ts';
import { mobileMoneyAvailable, regionOf } from './region.ts';
import { stripeCall, subscriptionPeriodEnd, type StripeConfig } from './stripe.ts';

/** Accès aux données de facturation (le client de service côté serveur, ou une fausse base dans les tests). */
export interface PaymentRow {
  orgId: string;
  provider: 'pawapay' | 'stripe' | 'gift';
  providerRef: string;
  plan: PaidPlanId;
  months: number;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
  createdAt: string;
}

export interface NewPendingPayment {
  orgId: string;
  userId: string | null;
  ref: string;
  plan: PaidPlanId;
  interval: Interval;
  amount: number;
  currency: string;
  usdAmount: number;
  country: string;
}

export interface StripeSubState {
  plan: PaidPlanId;
  status: 'active' | 'past_due' | 'canceled';
  interval: Interval;
  current_period_end: string;
  cancel_at_period_end: boolean;
  customer: string;
  subscription: string;
  currency: string;
  country: string | null;
  monthly_usd: number | null;
}

export interface StripePaymentRecord {
  invoice: string;
  plan: PaidPlanId;
  interval: Interval;
  amount: number;
  currency: string;
  usd_amount: number;
  country: string | null;
  period_start: string;
  period_end: string;
  user_id: string | null;
}

export interface BillingStore {
  createPending(row: NewPendingPayment): Promise<void>;
  getPayment(provider: 'pawapay' | 'stripe', ref: string): Promise<PaymentRow | null>;
  pendingPayments(olderThanMinutes: number, limit: number): Promise<PaymentRow[]>;
  /** `billing_settle_payment` : relève de la base (idempotent, vérifie montant et devise). */
  settle(ref: string, amount: number, currency: string): Promise<{ result: 'ok' | 'already' | 'unknown' | 'mismatch' | 'review' | 'refunded'; orgId?: string }>;
  fail(ref: string, reason: string, expired: boolean): Promise<boolean>;
  /** `billing_apply_stripe` : l'événement et ses effets en une transaction. */
  applyStripe(eventId: string, eventType: string, orgId: string, sub: StripeSubState | null, payment: StripePaymentRecord | null): Promise<'ok' | 'duplicate' | 'unknown_org'>;
}

// ---------------------------------------------------------------- mobile money (PawaPay)

export interface MobileMoneyDeps {
  store: BillingStore;
  pawapay: PawapayConfig;
  fetch?: typeof fetch;
  /** Adresse publique du site, pour le retour du paiement. En local (http), `returnBaseUrl` doit fournir une adresse https : PawaPay refuse le reste. */
  siteUrl: string;
  returnBaseUrl?: string | null;
  uuid: () => string;
  /** Pays où PawaPay a le mobile money actif (par défaut : la liste de repli). */
  countries?: readonly string[];
  now?: () => Date;
}

export interface MobileMoneyRequest {
  orgId: string;
  userId: string | null;
  plan: string;
  interval: string;
  country: string | null;
  phone?: string | null;
  language: 'EN' | 'FR';
  planLabel: string;
}

export type MobileMoneyStart =
  | { ok: true; url: string; depositId: string }
  | { ok: false; reason: 'plan' | 'country' | 'return_url' | 'phone' | 'provider'; transient?: boolean };

export function returnBase(siteUrl: string, override?: string | null): string | null {
  for (const base of [siteUrl, override ?? '']) if (/^https:\/\/[^\s/]+/.test(base)) return base.replace(/\/$/, '');
  return null;
}

export async function startMobileMoney(deps: MobileMoneyDeps, req: MobileMoneyRequest): Promise<MobileMoneyStart> {
  if (!isPaidPlanId(req.plan) || !isInterval(req.interval)) return { ok: false, reason: 'plan' };
  const region = regionOf(req.country);
  if (!region.country || !mobileMoneyAvailable(region.country, deps.countries)) return { ok: false, reason: 'country' };
  const base = returnBase(deps.siteUrl, deps.returnBaseUrl);
  if (!base) return { ok: false, reason: 'return_url' };

  const price = priceFor(req.plan, req.interval, region);
  const depositId = deps.uuid();
  let body: Record<string, unknown>;
  try {
    body = buildPaymentPageBody({
      depositId,
      returnUrl: `${base}/app/facturation/retour?depositId=${depositId}`,
      amount: price.amount,
      currency: price.currency,
      country: region.country,
      reason: `Postbiz ${req.planLabel} - ${req.interval === 'yearly' ? '12' : '1'} mois`,
      customerMessage: `Postbiz ${req.planLabel}`,
      language: req.language,
      phoneNumber: req.phone ?? null,
      metadata: { orgId: req.orgId, plan: req.plan, interval: req.interval, ...(req.userId ? { userId: req.userId } : {}) },
    });
  } catch (e) {
    return { ok: false, reason: /téléphone/.test((e as Error).message) ? 'phone' : 'plan' };
  }

  // La ligne existe AVANT l'appel : si la réponse se perd, le dépôt reste retrouvable et sera rapproché.
  await deps.store.createPending({
    orgId: req.orgId, userId: req.userId, ref: depositId, plan: req.plan, interval: req.interval,
    amount: price.amount, currency: price.currency, usdAmount: price.usd, country: region.country,
  });
  const page = await createPaymentPage(deps.pawapay, body, deps.fetch);
  if (!page.ok) {
    await deps.store.fail(depositId, page.code, false);
    return { ok: false, reason: 'provider', transient: page.transient };
  }
  return { ok: true, url: page.redirectUrl, depositId };
}

export type DepositOutcome = 'succeeded' | 'pending' | 'failed' | 'expired' | 'unknown' | 'review' | 'error';

/**
 * Relit le dépôt chez PawaPay et en tire les conséquences. C'est la SEULE voie par laquelle un paiement mobile money active une offre : ni l'adresse de
 * retour, ni le corps d'un rappel, ni le navigateur n'y suffisent. Idempotent ; appelable à volonté (retour, rappel, rapprochement).
 */
export async function confirmMobileMoney(deps: Pick<MobileMoneyDeps, 'store' | 'pawapay' | 'fetch' | 'now'>, depositId: string): Promise<DepositOutcome> {
  const row = await deps.store.getPayment('pawapay', depositId);
  if (!row) return 'unknown';
  if (row.status === 'succeeded') return 'succeeded';
  if (row.status === 'failed' || row.status === 'refunded') return 'failed';
  if (row.status === 'expired') return 'expired';

  const dep = await getDeposit(deps.pawapay, depositId, deps.fetch);
  switch (dep.state) {
    case 'completed': {
      if (dep.metadata.orgId && dep.metadata.orgId !== row.orgId) {
        await deps.store.fail(depositId, 'metadata_mismatch', false);
        return 'failed';
      }
      const r = await deps.store.settle(depositId, dep.amount, dep.currency);
      if (r.result === 'ok' || r.result === 'already') return 'succeeded';
      if (r.result === 'review') return 'review';
      if (r.result === 'unknown') return 'unknown';
      return 'failed';
    }
    case 'failed':
      await deps.store.fail(depositId, dep.code, false);
      return 'failed';
    case 'not_found': {
      const ageMin = ((deps.now?.() ?? new Date()).getTime() - new Date(row.createdAt).getTime()) / 60_000;
      if (ageMin >= DEPOSIT_PENDING_MINUTES) {
        await deps.store.fail(depositId, 'ABANDONED', true);
        return 'expired';
      }
      return 'pending';
    }
    case 'pending':
      return 'pending';
    default:
      return 'error';
  }
}

/** Rapproche les dépôts restés « en attente » (rappel perdu, retour jamais affiché). À appeler régulièrement (tâche planifiée). */
export async function reconcilePending(
  deps: Pick<MobileMoneyDeps, 'store' | 'pawapay' | 'fetch' | 'now'>, opts: { olderThanMinutes?: number; limit?: number } = {},
): Promise<Record<DepositOutcome, number>> {
  const counts: Record<DepositOutcome, number> = { succeeded: 0, pending: 0, failed: 0, expired: 0, unknown: 0, review: 0, error: 0 };
  const rows = await deps.store.pendingPayments(opts.olderThanMinutes ?? 3, opts.limit ?? 50);
  for (const r of rows) {
    if (r.provider !== 'pawapay') continue;
    counts[await confirmMobileMoney(deps, r.providerRef)]++;
  }
  return counts;
}

// ---------------------------------------------------------------- carte (Stripe)

const PRODUCT_NAMES: Record<PaidPlanId, string> = { standard: 'Postbiz Standard', team: 'Postbiz Team', agency: 'Postbiz Agence' };
export const stripeProductId = (plan: PaidPlanId) => `postbiz_${plan}`;

type Fetch = typeof fetch;

/** Crée le produit Stripe de l'offre s'il n'existe pas (identifiant fixe : rien à préparer dans le tableau de bord Stripe, et deux créations simultanées ne font qu'un produit). */
export async function ensureStripeProduct(cfg: StripeConfig, plan: PaidPlanId, doFetch: Fetch = fetch): Promise<boolean> {
  const id = stripeProductId(plan);
  const got = await stripeCall(cfg, 'GET', `/v1/products/${id}`, {}, doFetch);
  if (got.ok) return true;
  if (got.status !== 404) return false;
  const made = await stripeCall(cfg, 'POST', '/v1/products', { id, name: PRODUCT_NAMES[plan], metadata: { postbiz_plan: plan } }, doFetch);
  return made.ok || made.code === 'resource_already_exists';
}

export interface CardCheckoutRequest {
  orgId: string;
  userId: string | null;
  email: string | null;
  plan: string;
  interval: string;
  country: string | null;
  customerId?: string | null;
}

export type CardCheckoutStart = { ok: true; url: string } | { ok: false; reason: 'plan' | 'provider'; transient?: boolean };

const stripeCurrency = (c: string) => c.toLowerCase();

export async function startCardCheckout(
  deps: { cfg: StripeConfig; siteUrl: string; fetch?: Fetch }, req: CardCheckoutRequest,
): Promise<CardCheckoutStart> {
  if (!isPaidPlanId(req.plan) || !isInterval(req.interval)) return { ok: false, reason: 'plan' };
  const region = regionOf(req.country);
  if (!(await ensureStripeProduct(deps.cfg, req.plan, deps.fetch))) return { ok: false, reason: 'provider', transient: true };

  const metadata = {
    postbiz_org_id: req.orgId, postbiz_plan: req.plan, postbiz_interval: req.interval,
    ...(req.userId ? { postbiz_user_id: req.userId } : {}), ...(region.country ? { postbiz_country: region.country } : {}),
  };
  const create = (currency: string, amount: number) =>
    stripeCall(deps.cfg, 'POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: stripeCurrency(currency),
          product: stripeProductId(req.plan as PaidPlanId),
          unit_amount: minorUnits(amount, currency),
          recurring: { interval: req.interval === 'yearly' ? 'year' : 'month' },
        },
      }],
      client_reference_id: req.orgId,
      ...(req.customerId ? { customer: req.customerId } : req.email ? { customer_email: req.email } : {}),
      metadata,
      subscription_data: { metadata },
      success_url: `${deps.siteUrl}/app/facturation?paiement=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${deps.siteUrl}/app/facturation?paiement=annule`,
    }, deps.fetch);

  const price = priceFor(req.plan, req.interval, region);
  let res = await create(price.currency, price.amount);
  if (!res.ok && (price.currency === 'XAF' || price.currency === 'XOF') && /currenc/i.test(`${res.code} ${res.message}`)) {
    // Ce compte Stripe n'accepte pas les francs CFA : même tarif africain, en dollars.
    const usd = priceFor(req.plan, req.interval, { currency: 'USD', discounted: region.discounted });
    res = await create('USD', usd.amount);
  }
  if (!res.ok) return { ok: false, reason: 'provider', transient: res.transient };
  const url = res.data?.url;
  return typeof url === 'string' && url.startsWith('https://') ? { ok: true, url } : { ok: false, reason: 'provider' };
}

export async function startPortal(deps: { cfg: StripeConfig; siteUrl: string; fetch?: Fetch }, customerId: string): Promise<{ ok: true; url: string } | { ok: false }> {
  const res = await stripeCall(deps.cfg, 'POST', '/v1/billing_portal/sessions', { customer: customerId, return_url: `${deps.siteUrl}/app/facturation` }, deps.fetch);
  const url = res.ok ? res.data?.url : null;
  return typeof url === 'string' && url.startsWith('https://') ? { ok: true, url } : { ok: false };
}

// ---------------------------------------------------------------- événements Stripe

const fromMinor = (minor: number, currency: string) => (currency === 'USD' ? minor / 100 : minor);
const iso = (sec: number) => new Date(sec * 1000).toISOString();

const STATUS: Record<string, StripeSubState['status'] | null> = {
  active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', paused: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled', incomplete: null,
};

/** Abonnement Stripe (objet de l'API) → état à recopier. `null` si ce n'est pas un abonnement de Postbiz ou s'il n'est pas encore exploitable. */
export function subscriptionState(sub: any): { orgId: string; userId: string | null; state: StripeSubState } | null {
  const meta = sub?.metadata ?? {};
  const orgId = meta.postbiz_org_id;
  const plan = meta.postbiz_plan;
  const status = STATUS[String(sub?.status)] ?? null;
  const end = subscriptionPeriodEnd(sub);
  if (typeof orgId !== 'string' || !isPaidPlanId(plan) || !status || end === null) return null;
  const item = sub?.items?.data?.[0];
  const price = item?.price ?? sub?.plan;
  const currency = String(sub?.currency ?? price?.currency ?? '').toUpperCase();
  const interval: Interval = (price?.recurring?.interval ?? price?.interval) === 'year' ? 'yearly' : 'monthly';
  let monthlyUsd: number | null = null;
  try {
    const unit = Number(price?.unit_amount ?? price?.amount);
    if (Number.isFinite(unit)) monthlyUsd = Math.round((usdEquivalent(fromMinor(unit, currency), currency) / (interval === 'yearly' ? 12 : 1)) * 100) / 100;
  } catch {
    monthlyUsd = null;
  }
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (typeof sub.id !== 'string' || typeof customer !== 'string') return null;
  return {
    orgId,
    userId: typeof meta.postbiz_user_id === 'string' ? meta.postbiz_user_id : null,
    state: {
      plan, status, interval, current_period_end: iso(end), cancel_at_period_end: sub.cancel_at_period_end === true || (sub.cancel_at != null && status !== 'canceled'),
      customer, subscription: sub.id, currency, country: typeof meta.postbiz_country === 'string' ? meta.postbiz_country : null, monthly_usd: monthlyUsd,
    },
  };
}

/** Facture payée → ligne de paiement. Les montants à zéro (bon de réduction intégral) ne sont pas des paiements. */
export function invoicePayment(inv: any, s: { userId: string | null; state: StripeSubState }): StripePaymentRecord | null {
  const minor = Number(inv?.amount_paid);
  if (!Number.isFinite(minor) || minor <= 0 || typeof inv?.id !== 'string') return null;
  const currency = String(inv.currency ?? s.state.currency).toUpperCase();
  const period = inv.lines?.data?.[0]?.period;
  const start = Number(period?.start ?? inv.period_start);
  const end = Number(period?.end ?? inv.period_end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  let usd: number;
  const amount = fromMinor(minor, currency);
  try {
    usd = usdEquivalent(amount, currency);
  } catch {
    return null;
  }
  return {
    invoice: inv.id, plan: s.state.plan, interval: s.state.interval, amount, currency, usd_amount: usd, country: s.state.country,
    period_start: iso(start), period_end: iso(end), user_id: s.userId,
  };
}

export type StripeEventOutcome = 'ok' | 'duplicate' | 'unknown_org' | 'ignored';

const subIdOf = (obj: any): string | null => {
  const v = obj?.subscription ?? obj?.parent?.subscription_details?.subscription;
  return typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null;
};

/**
 * Applique un événement Stripe DÉJÀ authentifié (signature vérifiée par l'appelant). L'événement n'est qu'un déclencheur : l'abonnement est relu chez Stripe,
 * donc l'ordre des livraisons n'a pas d'importance. Les événements d'un autre site du même compte Stripe (sans nos métadonnées) sont ignorés.
 * Lève une erreur sur toute panne passagère (Stripe injoignable, base indisponible) pour que Stripe relivre l'événement.
 */
export async function handleStripeEvent(
  deps: { store: BillingStore; cfg: StripeConfig; fetch?: Fetch }, event: any,
): Promise<StripeEventOutcome> {
  const type = String(event?.type ?? '');
  const id = String(event?.id ?? '');
  const obj = event?.data?.object;
  if (!id || !obj) return 'ignored';
  const handled = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
  if (!handled.includes(type)) return 'ignored';

  let sub: any = type.startsWith('customer.subscription.') ? obj : null;
  const subId = sub ? null : subIdOf(obj);
  if (type === 'checkout.session.completed' && obj.mode !== 'subscription') return 'ignored';
  if (!sub) {
    if (!subId) return 'ignored';
    const got = await stripeCall(deps.cfg, 'GET', `/v1/subscriptions/${encodeURIComponent(subId)}`, {}, deps.fetch);
    if (!got.ok) {
      if (got.status === 404) return 'ignored';
      throw new Error(`Stripe : abonnement illisible (${got.code})`);
    }
    sub = got.data;
  } else if (type !== 'customer.subscription.deleted') {
    // L'objet de l'événement peut être plus ancien qu'un événement déjà traité : on relit l'état courant.
    const got = await stripeCall(deps.cfg, 'GET', `/v1/subscriptions/${encodeURIComponent(sub.id)}`, {}, deps.fetch);
    if (got.ok) sub = got.data;
    else if (got.transient) throw new Error(`Stripe : abonnement illisible (${got.code})`);
  }

  const s = subscriptionState(sub);
  if (!s) return 'ignored';
  const payment = type === 'invoice.paid' ? invoicePayment(obj, s) : null;
  return deps.store.applyStripe(id, type, s.orgId, s.state, payment);
}

/**
 * Retour de Stripe Checkout sur le site : confirme tout de suite la session (sans attendre le webhook), si elle appartient bien à l'espace courant.
 * Passe par la même voie idempotente que le webhook (identifiant d'événement propre au retour).
 */
export async function confirmCheckoutSession(
  deps: { store: BillingStore; cfg: StripeConfig; fetch?: Fetch }, sessionId: string, orgId: string,
): Promise<'ok' | 'pending' | 'foreign' | 'error'> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return 'foreign';
  const got = await stripeCall(deps.cfg, 'GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {}, deps.fetch);
  if (!got.ok) return got.status === 404 ? 'foreign' : 'error';
  const session = got.data;
  if (session?.metadata?.postbiz_org_id !== orgId) return 'foreign';
  if (session.status !== 'complete') return 'pending';
  // Si la première facture est déjà payée, on l'enregistre aussi : l'historique ne dépend pas de l'arrivée du webhook.
  const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
  let event: any = { id: `return:${sessionId}`, type: 'checkout.session.completed', data: { object: session } };
  if (typeof invoiceId === 'string') {
    const inv = await stripeCall(deps.cfg, 'GET', `/v1/invoices/${encodeURIComponent(invoiceId)}`, {}, deps.fetch);
    if (inv.ok && inv.data?.status === 'paid') event = { id: `return:${sessionId}`, type: 'invoice.paid', data: { object: inv.data } };
  }
  const outcome = await handleStripeEvent(deps, event);
  return outcome === 'ok' || outcome === 'duplicate' ? 'ok' : 'error';
}
