import { CFA_PER_EUR, CFA_ROUNDING, LOCAL_DISCOUNT, YEARLY_DISCOUNT, usdPerEur } from './config.ts';
import { USD_MONTHLY, type Interval, type PaidPlanId } from './plans.ts';
import type { PriceCurrency, Region } from './region.ts';

const isCfa = (c: PriceCurrency) => c === 'XAF' || c === 'XOF';
/** Plus petit montant facturé : 500 F pour les francs CFA, 1 $ en dollars. */
const stepOf = (c: PriceCurrency) => (isCfa(c) ? CFA_ROUNDING : 1);
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const cents = (n: number) => Math.round(n * 100) / 100;

/** Dollars → francs CFA, sans rabais ni arrondi (parité fixe avec l'euro). */
export const usdToCfa = (usd: number, usdPerEuro: number = usdPerEur()): number => (usd / usdPerEuro) * CFA_PER_EUR;

/** Prix mensuel d'une offre dans la monnaie de la région, rabais local et arrondi compris. */
export function monthlyPrice(plan: PaidPlanId, region: Pick<Region, 'currency' | 'discounted'>, usdPerEuro: number = usdPerEur()): number {
  const usd = USD_MONTHLY[plan];
  const discount = region.discounted ? 1 - LOCAL_DISCOUNT : 1;
  if (isCfa(region.currency)) return roundTo(usdToCfa(usd, usdPerEuro) * discount, CFA_ROUNDING);
  return roundTo(usd * discount, 1);
}

export interface Price {
  currency: PriceCurrency;
  interval: Interval;
  /** Montant facturé à chaque période (un mois, ou douze mois d'un coup à l'année). */
  amount: number;
  /** Équivalent par mois, pour l'affichage. */
  perMonth: number;
  /** Ce que coûteraient 12 mois au tarif mensuel (pour montrer l'économie de l'annuel). */
  yearlyAtMonthlyRate: number;
  /** Même prix en dollars (reporting, MRR). */
  usd: number;
}

export function priceFor(plan: PaidPlanId, interval: Interval, region: Pick<Region, 'currency' | 'discounted'>, usdPerEuro: number = usdPerEur()): Price {
  const monthly = monthlyPrice(plan, region, usdPerEuro);
  const step = stepOf(region.currency);
  const amount = interval === 'yearly' ? roundTo(monthly * 12 * (1 - YEARLY_DISCOUNT), step) : monthly;
  const months = interval === 'yearly' ? 12 : 1;
  return {
    currency: region.currency,
    interval,
    amount,
    perMonth: amount / months,
    yearlyAtMonthlyRate: monthly * 12,
    usd: usdEquivalent(amount, region.currency, usdPerEuro),
  };
}

/** Équivalent en dollars d'un montant (taux du jour de `config.ts`). */
export function usdEquivalent(amount: number, currency: PriceCurrency | string, usdPerEuro: number = usdPerEur()): number {
  if (currency === 'USD') return cents(amount);
  if (currency === 'XAF' || currency === 'XOF') return cents((amount / CFA_PER_EUR) * usdPerEuro);
  throw new Error(`Devise non prise en charge : ${currency}`);
}

/** Montant dans la plus petite unité de la monnaie (centimes pour le dollar ; le franc CFA n'a pas de décimales). */
export function minorUnits(amount: number, currency: PriceCurrency | string): number {
  if (currency === 'USD') return Math.round(amount * 100);
  if (currency === 'XAF' || currency === 'XOF') return Math.round(amount);
  throw new Error(`Devise non prise en charge : ${currency}`);
}

/** Montant affiché dans la langue : « 9 500 FCFA », « 19 $US », « $19.00 »… */
export function formatMoney(tag: string, amount: number, currency: string): string {
  const cfa = currency === 'XAF' || currency === 'XOF';
  return new Intl.NumberFormat(tag, { style: 'currency', currency, maximumFractionDigits: cfa || Number.isInteger(amount) ? 0 : 2, minimumFractionDigits: cfa || Number.isInteger(amount) ? 0 : 2 }).format(amount);
}

/** Économie annuelle (mêmes unités que `amount`). */
export const yearlySavings = (p: Price): number => (p.interval === 'yearly' ? Math.max(0, p.yearlyAtMonthlyRate - p.amount) : 0);
