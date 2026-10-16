'use client';

import { useState } from 'react';
import { ButtonLink } from '@/components/ui';
import { Badge } from '@/components/ui';
import { PLANS, YEARLY_DISCOUNT, formatEuro, pricePerMonth, yearlySavings, type Billing } from '@/lib/pricing';

export function PricingPlans() {
  const [billing, setBilling] = useState<Billing>('yearly');

  return (
    <div>
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="Période de facturation" className="inline-flex rounded-full border border-line bg-surface p-1">
          {(['monthly', 'yearly'] as const).map((b) => (
            <button
              key={b}
              role="radio"
              aria-checked={billing === b}
              onClick={() => setBilling(b)}
              className={`flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${billing === b ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {b === 'monthly' ? 'Mensuel' : 'Annuel'}
              {b === 'yearly' && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${billing === 'yearly' ? 'bg-lime text-ink' : 'bg-lime-soft text-forest'}`}>
                  −{Math.round(YEARLY_DISCOUNT * 100)} %
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-4">
        {PLANS.map((p) => (
          <article
            key={p.id}
            className={`relative flex flex-col rounded-3xl border p-7 ${p.popular ? 'border-ink bg-surface shadow-[0_20px_50px_-25px_rgba(17,17,16,0.45)]' : 'border-line bg-surface'}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">{p.name}</h3>
              {p.popular && <Badge tone="lime">Populaire</Badge>}
            </div>
            <p className="mt-2 min-h-[44px] text-[15px] leading-snug text-muted">{p.tagline}</p>
            <p className="mt-6 flex items-baseline gap-1.5">
              <span className="text-5xl font-semibold tracking-tight">{formatEuro(pricePerMonth(p, billing))}</span>
              <span className="text-muted">/ mois</span>
            </p>
            <p className="mt-1 h-5 text-sm text-subtle">
              {billing === 'yearly' ? `Facturé à l’année · vous économisez ${formatEuro(yearlySavings(p))}` : 'Facturé au mois'}
            </p>
            <ButtonLink href={`/signup?plan=${p.id}`} variant={p.popular ? 'primary' : 'secondary'} className="mt-6 w-full">
              Commencer gratuitement
            </ButtonLink>
            <ul className="mt-7 grid gap-3 border-t border-line pt-6 text-[15px]">
              {p.inheritsFrom && <li className="font-semibold">Tout {p.inheritsFrom === 'Starter' ? 'de Starter' : `de ${p.inheritsFrom}`}, plus :</li>}
              {p.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <svg className="mt-1 shrink-0 text-forest-2" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2.5 7.3 2.8 2.8 6-6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}

        <article className="flex flex-col rounded-3xl border border-dashed border-ink/30 bg-wash p-7">
          <h3 className="text-xl font-semibold">Sur mesure</h3>
          <p className="mt-2 min-h-[44px] text-[15px] leading-snug text-muted">Pour une organisation avec des besoins spécifiques.</p>
          <p className="mt-6 text-5xl font-semibold tracking-tight">Devis</p>
          <p className="mt-1 h-5 text-sm text-subtle">Selon votre usage</p>
          <ButtonLink href="/contact?sujet=sur-mesure" variant="secondary" className="mt-6 w-full">Nous contacter</ButtonLink>
          <ul className="mt-7 grid gap-3 border-t border-line pt-6 text-[15px]">
            {['Hébergement dédié possible', 'Accompagnement à la mise en place', 'Contrat sur mesure'].map((f) => (
              <li key={f} className="flex gap-2.5">
                <svg className="mt-1 shrink-0 text-forest-2" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2.5 7.3 2.8 2.8 6-6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </div>
  );
}
