import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Button } from '@/components/ui';
import { formatFullDate } from '@/i18n/format';
import { LOCALE_META } from '@/i18n/config';
import { getT } from '@/i18n/server';
import { isInterval, isPaidPlanId, planNameKey, type LimitKey, type PaidPlanId } from '@/lib/billing/plans';
import { formatMoney } from '@/lib/billing/price';
import { mobileMoneyAvailable } from '@/lib/billing/region';
import { billingStore, loadBillingView, mobileMoneyCountries, providerConfigs, visitorRegion } from '@/lib/billing/server';
import { confirmCheckoutSession } from '@/lib/billing/service';
import { getSession } from '@/lib/data';
import { cancelDemoAction, openPortalAction } from './actions';
import { PlanPicker } from './plan-picker';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('app.titles.billing') };
}
export const dynamic = 'force-dynamic';

const card = 'rounded-3xl border border-line bg-surface p-6';
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const USAGE_ROWS: LimitKey[] = ['channels', 'members', 'images_per_month', 'videos_per_month', 'ai_text_per_month', 'storage_mb'];

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const tag = LOCALE_META[t.locale].tag;
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const params = await searchParams;

  // Retour de Stripe Checkout : on confirme la session tout de suite (le webhook arrive en parallèle et ne fait pas double emploi : même voie idempotente).
  const returned = first(params.paiement);
  const sessionId = first(params.session_id);
  let flash: 'ok' | 'pending' | 'cancel' | 'cancelled' | null = returned === 'annule' ? 'cancel' : returned === 'annulation' ? 'cancelled' : null;
  if (returned === 'ok') {
    flash = 'ok';
    const { stripe } = providerConfigs();
    const store = billingStore();
    if (ctx.mode === 'supabase' && sessionId && stripe && store) {
      const r = await confirmCheckoutSession({ store, cfg: stripe }, sessionId, ctx.org.id).catch(() => 'error' as const);
      if (r === 'pending' || r === 'error') flash = 'pending';
    }
  }

  const [view, visitor] = await Promise.all([loadBillingView(ctx), visitorRegion()]);
  const countries = await mobileMoneyCountries();
  const mobileMoney = view.methods.mobileMoney && mobileMoneyAvailable(visitor.region.country, countries);
  const error = first(params.erreur);

  const wantedPlan = first(params.plan);
  const initialPlan: PaidPlanId = isPaidPlanId(wantedPlan) ? wantedPlan : view.plan === 'free' ? 'standard' : view.plan === 'standard' ? 'team' : view.plan === 'team' ? 'agency' : 'agency';
  const wantedInterval = first(params.interval);
  const initialInterval = isInterval(wantedInterval) ? wantedInterval : 'yearly';

  const date = (iso: string | null) => (iso ? formatFullDate(t.locale, new Date(iso)) : '');
  const sub = view.subscription;
  const planName = t(planNameKey(view.plan));
  const until = date(view.phase === 'trialing' ? sub?.trialEndsAt ?? null : view.phase === 'grace' ? sub?.graceEndsAt ?? null : sub?.currentPeriodEnd ?? null);
  const phaseText =
    view.phase === 'trialing' ? t('billing.phase.trialing', { plan: planName, date: until })
    : view.phase === 'paying' ? (sub?.cancelAtPeriodEnd ? t('billing.phase.cancelling', { plan: planName, date: until }) : t('billing.phase.paying', { plan: planName, date: until }))
    : view.phase === 'grace' ? t('billing.phase.grace', { plan: planName, date: until })
    : view.phase === 'gift' ? t('billing.phase.gift', { plan: planName, date: until })
    : view.phase === 'ended' ? t('billing.phase.ended')
    : t('billing.phase.free', { plan: planName });

  const limitText = (key: LimitKey, v: number) => (key === 'storage_mb'
    ? new Intl.NumberFormat(tag, { style: 'unit', unit: v >= 1000 ? 'gigabyte' : 'megabyte', maximumFractionDigits: 1 }).format(v >= 1000 ? v / 1000 : v)
    : new Intl.NumberFormat(tag).format(v));

  const paidWithStripe = sub?.provider === 'stripe' && !!view.stripeCustomerId;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('billing.title')}</h1>
      <p className="mt-1 text-muted">{t('billing.subtitle')}</p>

      {view.demo && <p className="mt-5 rounded-2xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm font-medium text-warn">{t('billing.demo')}</p>}
      {!view.enabled && !view.demo && <p className="mt-5 rounded-2xl border border-line bg-wash px-4 py-3 text-sm text-muted">{t('billing.betaNotice')}</p>}
      {flash === 'ok' && <p role="status" className="mt-5 rounded-2xl border border-ok/25 bg-ok-soft px-4 py-3 text-sm font-medium text-ok">{t('billing.flash.ok')}</p>}
      {flash === 'pending' && <p role="status" className="mt-5 rounded-2xl border border-line bg-wash px-4 py-3 text-sm text-muted">{t('billing.flash.pending')}</p>}
      {flash === 'cancel' && <p role="status" className="mt-5 rounded-2xl border border-line bg-wash px-4 py-3 text-sm text-muted">{t('billing.flash.cancel')}</p>}
      {flash === 'cancelled' && <p role="status" className="mt-5 rounded-2xl border border-line bg-wash px-4 py-3 text-sm text-muted">{t('billing.flash.cancelled')}</p>}
      {error && <p role="alert" className="mt-5 rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{t(`billing.error.${['forbidden', 'plan', 'disabled', 'config', 'provider', 'country', 'phone', 'return_url', 'has_card', 'has_prepaid', 'has_gift', 'portal'].includes(error) ? error : 'provider'}` as never)}</p>}

      <section className={`${card} mt-6`} aria-labelledby="offre">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="offre" className="text-lg font-semibold">{t('billing.current.title')}</h2>
          <Badge tone={view.plan === 'free' ? 'neutral' : 'lime'}>{planName}</Badge>
        </div>
        <p className="mt-3 text-[15px]">{phaseText}</p>
        {view.canManage && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {paidWithStripe && (
              <form action={openPortalAction}><Button type="submit" variant="secondary" size="sm">{t('billing.manage')}</Button></form>
            )}
            {view.demo && sub?.status === 'active' && !sub.cancelAtPeriodEnd && (
              <form action={cancelDemoAction}><Button type="submit" variant="secondary" size="sm">{t('billing.cancelDemo')}</Button></form>
            )}
          </div>
        )}
        {(sub?.provider === 'pawapay') && (view.phase === 'paying' || view.phase === 'grace') && <p className="mt-3 text-sm text-muted">{t('billing.cancelHint.prepaid')}</p>}
      </section>

      <section className={`${card} mt-6`} aria-labelledby="usage">
        <h2 id="usage" className="text-lg font-semibold">{t('billing.usage.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('billing.usage.month')}</p>
        <ul className="mt-4 grid gap-4">
          {USAGE_ROWS.map((k) => {
            const limit = view.limits[k];
            const used = view.usage[k] ?? 0;
            const ratio = limit === null ? 0 : limit === 0 ? 1 : Math.min(1, used / limit);
            return (
              <li key={k}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{t(`pricing.limit.${k}`)}</span>
                  <span className="text-muted" dir="ltr">
                    {limit === null ? t('billing.usage.unlimitedValue', { used: limitText(k, used) }) : t('billing.usage.value', { used: limitText(k, used), limit: limitText(k, limit) })}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-wash" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={t(`pricing.limit.${k}`)}>
                  <div className={`h-full rounded-full ${ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warn' : 'bg-forest-2'}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={`${card} mt-6`} aria-labelledby="changer">
        <h2 id="changer" className="text-lg font-semibold">{t('billing.change.title')}</h2>
        {!view.canManage ? (
          <p className="mt-3 text-sm text-muted">{t('billing.admin.only')}</p>
        ) : !view.enabled ? (
          <p className="mt-3 text-sm text-muted">{t('billing.betaNotice')}</p>
        ) : (
          <PlanPicker
            country={visitor.country}
            initialPlan={initialPlan}
            initialInterval={initialInterval}
            currentPlan={view.plan}
            card={view.methods.card}
            mobileMoney={mobileMoney}
          />
        )}
      </section>

      <section className={`${card} mt-6`} aria-labelledby="historique">
        <h2 id="historique" className="text-lg font-semibold">{t('billing.history.title')}</h2>
        {!view.canManage ? (
          <p className="mt-3 text-sm text-muted">{t('billing.admin.only')}</p>
        ) : view.payments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('billing.history.empty')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-start text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('billing.history.date')}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('billing.history.plan')}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('billing.history.method')}</th>
                  <th scope="col" className="py-2 pe-3 text-end font-medium">{t('billing.history.amount')}</th>
                  <th scope="col" className="py-2 text-start font-medium">{t('billing.history.status')}</th>
                </tr>
              </thead>
              <tbody>
                {view.payments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pe-3">{date(p.createdAt)}</td>
                    <td className="py-2.5 pe-3">{t(planNameKey(p.plan))}</td>
                    <td className="py-2.5 pe-3">{t(`billing.provider.${p.provider}`)}</td>
                    <td className="py-2.5 pe-3 text-end" dir="ltr">{p.provider === 'gift' ? '—' : formatMoney(tag, p.amount, p.currency)}</td>
                    <td className="py-2.5"><Badge tone={p.status === 'succeeded' ? 'ok' : p.status === 'pending' ? 'neutral' : 'warn'}>{t(`billing.status.${p.status}`)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
