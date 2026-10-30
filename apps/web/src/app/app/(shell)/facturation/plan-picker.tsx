'use client';

import { useState } from 'react';
import { RegionSelect } from '@/components/billing/region-select';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { LOCALE_META } from '@/i18n/config';
import { YEARLY_DISCOUNT } from '@/lib/billing/config';
import { PAID_PLAN_IDS, planNameKey, type Interval, type PaidPlanId } from '@/lib/billing/plans';
import { formatMoney, priceFor, yearlySavings } from '@/lib/billing/price';
import { regionOf } from '@/lib/billing/region';
import { startCheckoutAction } from './actions';

export interface PlanPickerProps {
  country: string | null;
  initialPlan: PaidPlanId;
  initialInterval: Interval;
  currentPlan: string;
  card: boolean;
  /** Le mobile money est proposé (configuré ET actif dans le pays du visiteur). */
  mobileMoney: boolean;
}

export function PlanPicker({ country, initialPlan, initialInterval, currentPlan, card, mobileMoney }: PlanPickerProps) {
  const t = useT();
  const tag = LOCALE_META[t.locale].tag;
  const [plan, setPlan] = useState<PaidPlanId>(initialPlan);
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [method, setMethod] = useState<'card' | 'mobile_money'>(mobileMoney && !card ? 'mobile_money' : card ? 'card' : 'mobile_money');
  const region = regionOf(country === 'ZZ' ? null : country);
  const money = (n: number) => formatMoney(tag, n, region.currency);
  const price = priceFor(plan, interval, region);
  const none = !card && !mobileMoney;

  return (
    <form action={startCheckoutAction} className="mt-5 grid gap-6">
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />
      <input type="hidden" name="method" value={method} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div role="radiogroup" aria-label={t('pricing.billingLabel')} className="inline-flex rounded-full border border-line bg-surface p-1">
          {(['monthly', 'yearly'] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={interval === b} onClick={() => setInterval(b)}
              className={`flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${interval === b ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>
              {b === 'monthly' ? t('pricing.monthly') : t('pricing.yearly')}
              {b === 'yearly' && <span className={`rounded-full px-2 py-0.5 text-xs ${interval === 'yearly' ? 'bg-lime text-ink' : 'bg-lime-soft text-forest'}`}>{t('pricing.discount', { percent: Math.round(YEARLY_DISCOUNT * 100) })}</span>}
            </button>
          ))}
        </div>
        <RegionSelect country={country} id="facturation-region" />
      </div>

      <div role="radiogroup" aria-label={t('billing.change.title')} className="grid gap-3 sm:grid-cols-3">
        {PAID_PLAN_IDS.map((id) => {
          const p = priceFor(id, interval, region);
          const selected = plan === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={selected} onClick={() => setPlan(id)}
              className={`rounded-2xl border p-4 text-start transition-colors ${selected ? 'border-ink bg-wash' : 'border-line bg-surface hover:bg-wash'}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t(planNameKey(id))}</span>
                {currentPlan === id && <span className="rounded-full bg-lime-soft px-2 py-0.5 text-xs font-semibold text-forest">{t('billing.current.badge')}</span>}
              </span>
              <span className="mt-2 block text-2xl font-semibold tracking-tight" dir="ltr">{money(Math.round(p.perMonth))}<span className="text-sm font-medium text-muted"> {t('pricing.perMonth')}</span></span>
              {interval === 'yearly' && <span className="mt-1 block text-sm text-subtle">{t('pricing.billedYearlyTotal', { total: money(p.amount), amount: money(yearlySavings(p)) })}</span>}
            </button>
          );
        })}
      </div>

      {none ? (
        <p className="rounded-2xl border border-line bg-wash px-4 py-3 text-sm text-muted">{t('billing.error.config')}</p>
      ) : (
        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold">{t('billing.change.method')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {card && (
              <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${method === 'card' ? 'border-ink bg-wash' : 'border-line'}`}>
                <input type="radio" name="method-ui" checked={method === 'card'} onChange={() => setMethod('card')} className="mt-1" />
                <span><span className="block font-semibold">{t('billing.method.card')}</span><span className="block text-sm text-muted">{t('billing.method.cardHint')}</span></span>
              </label>
            )}
            <label className={`flex gap-3 rounded-2xl border p-4 ${mobileMoney ? 'cursor-pointer' : 'opacity-60'} ${method === 'mobile_money' && mobileMoney ? 'border-ink bg-wash' : 'border-line'}`}>
              <input type="radio" name="method-ui" checked={method === 'mobile_money'} disabled={!mobileMoney} onChange={() => setMethod('mobile_money')} className="mt-1" />
              <span>
                <span className="block font-semibold">{t('billing.method.mobile')}</span>
                <span className="block text-sm text-muted">{mobileMoney ? t('billing.method.mobileHint') : t('billing.method.mobileUnavailable')}</span>
              </span>
            </label>
          </div>
          {method === 'mobile_money' && mobileMoney && (
            <div className="grid gap-1.5">
              <label htmlFor="phone" className="text-sm font-medium">{t('billing.phone.label')}</label>
              <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="237670123456" dir="ltr"
                className="h-11 max-w-xs rounded-xl border border-line bg-surface px-4 text-[15px]" />
              <p className="text-sm text-muted">{t('billing.phone.hint')}</p>
            </div>
          )}
        </fieldset>
      )}

      <div className="grid gap-2">
        <Button type="submit" size="lg" disabled={none} className="w-full sm:w-auto sm:justify-self-start">
          {method === 'card' ? t('billing.pay.card', { amount: money(price.amount) }) : t('billing.pay.mobile', { amount: money(price.amount) })}
        </Button>
        <p className="text-sm text-muted">
          {method === 'card' ? t('billing.note.card') : t('billing.note.mobile', { period: interval === 'yearly' ? t('billing.period.yearly') : t('billing.period.monthly') })}
        </p>
      </div>
    </form>
  );
}
