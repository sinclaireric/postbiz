'use client';

import { useState } from 'react';
import { RegionSelect } from '@/components/billing/region-select';
import { Badge, ButtonLink } from '@/components/ui';
import { useT } from '@/i18n/client';
import { LOCALE_META } from '@/i18n/config';
import { YEARLY_DISCOUNT, LOCAL_DISCOUNT } from '@/lib/billing/config';
import { PLAN_IDS, PLAN_LIMITS, planNameKey, planTaglineKey, type Interval, type LimitKey, type PlanId } from '@/lib/billing/plans';
import { formatMoney, priceFor, yearlySavings } from '@/lib/billing/price';
import { regionOf } from '@/lib/billing/region';

const Check = () => (
  <svg className="mt-1 shrink-0 text-forest-2" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2.5 7.3 2.8 2.8 6-6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** Limites montrées sur chaque carte (les autres sont dans le tableau comparatif). */
const CARD_LIMITS: LimitKey[] = ['channels', 'members', 'images_per_month', 'ai_text_per_month', 'storage_mb'];
const POPULAR: PlanId = 'team';

export interface PricingProps {
  /** Pays détecté ou choisi (alpha-2, ou « ZZ » pour un autre pays) ; null = inconnu. */
  country: string | null;
  /** La facturation est-elle activée ? Sinon, bêta gratuite : les prix sont annoncés mais rien n'est facturé. */
  billingEnabled: boolean;
  /** Le mobile money est-il proposé dans ce pays ? */
  mobileMoney: boolean;
  signedIn: boolean;
}

export function PricingPlans({ country, billingEnabled, mobileMoney, signedIn }: PricingProps) {
  const t = useT();
  const tag = LOCALE_META[t.locale].tag;
  const [interval, setInterval] = useState<Interval>('yearly');
  const region = regionOf(country === 'ZZ' ? null : country);
  const money = (n: number) => formatMoney(tag, n, region.currency);
  const number = (n: number) => new Intl.NumberFormat(tag).format(n);
  const storage = (mb: number) => new Intl.NumberFormat(tag, { style: 'unit', unit: mb >= 1000 ? 'gigabyte' : 'megabyte', maximumFractionDigits: 0 }).format(mb >= 1000 ? mb / 1000 : mb);

  const limitValue = (plan: PlanId, key: LimitKey): string => {
    const v = PLAN_LIMITS[plan][key];
    if (v === null) return t('pricing.compare.unlimited');
    return key === 'storage_mb' ? storage(v) : number(v);
  };

  return (
    <div>
      {!billingEnabled && <p className="mx-auto mb-8 max-w-2xl rounded-2xl border border-line bg-wash px-5 py-3 text-center text-sm text-muted">{t('pricing.betaNotice')}</p>}

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <div role="radiogroup" aria-label={t('pricing.billingLabel')} className="inline-flex rounded-full border border-line bg-surface p-1">
          {(['monthly', 'yearly'] as const).map((b) => (
            <button
              key={b}
              role="radio"
              aria-checked={interval === b}
              onClick={() => setInterval(b)}
              className={`flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${interval === b ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {b === 'monthly' ? t('pricing.monthly') : t('pricing.yearly')}
              {b === 'yearly' && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${interval === 'yearly' ? 'bg-lime text-ink' : 'bg-lime-soft text-forest'}`}>
                  {t('pricing.discount', { percent: Math.round(YEARLY_DISCOUNT * 100) })}
                </span>
              )}
            </button>
          ))}
        </div>
        <RegionSelect country={country} />
      </div>
      <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted">
        {region.discounted
          ? t('pricing.region.noteLocal', { percent: Math.round(LOCAL_DISCOUNT * 100) })
          : t('pricing.region.noteWorld')}
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_IDS.map((id) => {
          const paid = id !== 'free';
          const price = paid ? priceFor(id, interval, region) : null;
          const popular = id === POPULAR;
          const href = signedIn
            ? paid ? `/app/facturation?plan=${id}&interval=${interval}` : '/app/facturation'
            : paid ? `/signup?plan=${id}&interval=${interval}` : '/signup';
          return (
            <article
              key={id}
              className={`relative flex flex-col rounded-3xl border p-7 ${popular ? 'border-ink bg-surface shadow-[0_20px_50px_-25px_rgba(17,17,16,0.45)]' : 'border-line bg-surface'}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">{t(planNameKey(id))}</h3>
                {popular && <Badge tone="lime">{t('pricing.popular')}</Badge>}
              </div>
              <p className="mt-2 min-h-[66px] text-[15px] leading-snug text-muted">{t(planTaglineKey(id))}</p>
              <p className="mt-6 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-4xl font-semibold tracking-tight" dir="ltr">{price ? money(Math.round(price.perMonth)) : money(0)}</span>
                <span className="text-muted">{t('pricing.perMonth')}</span>
              </p>
              <p className="mt-1 min-h-10 text-sm text-subtle">
                {!price
                  ? t('pricing.freeNote')
                  : interval === 'yearly'
                    ? t('pricing.billedYearlyTotal', { total: money(price.amount), amount: money(yearlySavings(price)) })
                    : t('pricing.billedMonthly')}
              </p>
              <ButtonLink href={href} variant={popular ? 'primary' : 'secondary'} className="mt-6 w-full">
                {paid ? t('pricing.ctaPaid', { plan: t(planNameKey(id)) }) : t('pricing.cta')}
              </ButtonLink>
              <ul className="mt-7 grid gap-3 border-t border-line pt-6 text-[15px]">
                {CARD_LIMITS.map((k) => (
                  <li key={k} className="flex gap-2.5"><Check /><span>{t(`pricing.limit.${k}`)} : <strong className="font-semibold" dir="ltr">{limitValue(id, k)}</strong></span></li>
                ))}
                <li className="flex gap-2.5"><Check /><span>{t('pricing.feature.core')}</span></li>
                <li className="flex gap-2.5"><Check /><span>{t('pricing.feature.mobile')}</span></li>
                {(id === 'team' || id === 'agency') && <li className="flex gap-2.5"><Check /><span>{t('pricing.feature.priority')}</span></li>}
              </ul>
            </article>
          );
        })}
      </div>

      <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted">{mobileMoney ? t('pricing.pay.mobile') : t('pricing.pay.card')}</p>

      <article className="mt-8 flex flex-col gap-4 rounded-3xl border border-dashed border-ink/30 bg-wash p-7 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold">{t('pricing.custom.name')}</h3>
          <p className="mt-1 text-[15px] text-muted">{t('pricing.custom.tagline')}</p>
        </div>
        <ButtonLink href="/contact?sujet=sur-mesure" variant="secondary" className="shrink-0">{t('pricing.custom.cta')}</ButtonLink>
      </article>
    </div>
  );
}
