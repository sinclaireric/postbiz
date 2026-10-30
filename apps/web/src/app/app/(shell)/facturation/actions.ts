'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { demoCancel, demoPay } from '@/lib/billing/demo';
import { isInterval, isPaidPlanId, planNameKey, type Subscription } from '@/lib/billing/plans';
import { billingEnabled, billingStore, mobileMoneyCountries, providerConfigs, visitorRegion } from '@/lib/billing/server';
import { startCardCheckout, startMobileMoney, startPortal } from '@/lib/billing/service';
import { getSession } from '@/lib/data';
import { siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

/** Retour sur la page avec un code d'erreur (traduit à l'affichage). `redirect` interrompt la fonction : à appeler en dernier. */
function back(code: string): never {
  redirect(`/app/facturation?erreur=${code}`);
}

async function currentSubscription(orgId: string): Promise<{ sub: Subscription | null; customerId: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.from('subscriptions')
    .select('status, provider, current_period_end, grace_ends_at, stripe_customer_id').eq('org_id', orgId).maybeSingle();
  if (!data) return { sub: null, customerId: null };
  return {
    sub: { status: data.status, provider: data.provider, currentPeriodEnd: data.current_period_end, graceEndsAt: data.grace_ends_at } as Subscription,
    customerId: data.stripe_customer_id ?? null,
  };
}

/** Lance le paiement de l'offre choisie (carte : Stripe Checkout ; mobile money : page de paiement PawaPay), puis redirige vers le fournisseur. */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  // Seul un administrateur de l'espace modifie son abonnement (la base le vérifiera aussi pour tout le reste).
  if (ctx.org.role !== 'admin') back('forbidden');

  const plan = String(formData.get('plan') ?? '');
  const interval = String(formData.get('interval') ?? '');
  const method = String(formData.get('method') ?? '');
  if (!isPaidPlanId(plan) || !isInterval(interval) || (method !== 'card' && method !== 'mobile_money')) back('plan');
  const visitor = await visitorRegion();
  const country = visitor.region.country;

  if (ctx.mode === 'demo') {
    demoPay(ctx.org.id, plan, interval, method, country);
    redirect('/app/facturation?paiement=ok');
  }
  if (!(await billingEnabled())) back('disabled');

  const { sub, customerId } = await currentSubscription(ctx.org.id);
  const live = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() > Date.now();
  if (sub?.provider === 'stripe' && (sub.status === 'active' || sub.status === 'past_due') && live(sub.graceEndsAt ?? sub.currentPeriodEnd)) back('has_card');
  if (sub?.provider === 'pawapay' && sub.status === 'active' && live(sub.currentPeriodEnd) && method === 'card') back('has_prepaid');
  if (sub?.provider === 'gift' && sub.status === 'active' && live(sub.currentPeriodEnd)) back('has_gift');

  const t = await getT();
  const cfg = providerConfigs();
  let url: string | null = null;
  let failure = 'provider';

  if (method === 'card') {
    if (!cfg.stripe) back('config');
    const r = await startCardCheckout({ cfg: cfg.stripe!, siteUrl }, {
      orgId: ctx.org.id, userId: ctx.user.id, email: ctx.user.email || null, plan, interval, country, customerId,
    });
    if (r.ok) url = r.url;
    else failure = r.reason;
  } else {
    const store = billingStore();
    if (!cfg.pawapay || !store) back('config');
    const r = await startMobileMoney({
      store: store!, pawapay: cfg.pawapay!, siteUrl, returnBaseUrl: process.env.BILLING_RETURN_BASE_URL, uuid: randomUUID, countries: await mobileMoneyCountries(cfg.pawapay),
    }, {
      orgId: ctx.org.id, userId: ctx.user.id, plan, interval, country, phone: String(formData.get('phone') ?? '').trim() || null,
      language: t.locale === 'fr' ? 'FR' : 'EN', planLabel: t(planNameKey(plan)),
    });
    if (r.ok) url = r.url;
    else failure = r.reason;
  }
  if (!url) back(failure);
  redirect(url!);
}

/** Portail client Stripe : carte, factures, annulation. */
export async function openPortalAction(): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  if (ctx.org.role !== 'admin') back('forbidden');
  const cfg = providerConfigs();
  if (ctx.mode === 'supabase' && cfg.stripe) {
    const { customerId } = await currentSubscription(ctx.org.id);
    if (customerId) {
      const r = await startPortal({ cfg: cfg.stripe, siteUrl }, customerId);
      if (r.ok) redirect(r.url);
    }
  }
  back('portal');
}

/** Annulation en démonstration (en vrai : portail Stripe pour la carte ; le mobile money n'a rien à annuler, il s'arrête à la fin de la période). */
export async function cancelDemoAction(): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.mode !== 'demo') redirect('/app/facturation');
  demoCancel(session.ctx.org.id);
  redirect('/app/facturation?paiement=annulation');
}
