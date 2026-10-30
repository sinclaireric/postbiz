/**
 * Paramètres de la facturation modifiables en un seul endroit. Les montants affichés et facturés en dollars viennent de `plans.ts` ;
 * les prix en francs CFA s'en déduisent avec les taux ci-dessous (voir `price.ts`).
 */

/** Dollars pour un euro (référence : Banque centrale européenne, 23 octobre 2026). `BILLING_USD_PER_EUR` le remplace sans redéployer le code. */
export const USD_PER_EUR_REFERENCE = 1.1193;
export const RATES_AS_OF = '2026-10-23';
/** Francs CFA (XAF et XOF) pour un euro : parité fixe, identique pour les deux monnaies. */
export const CFA_PER_EUR = 655.957;

/** Rabais appliqué en plus de la conversion dans les pays où l'on facture en monnaie locale. */
export const LOCAL_DISCOUNT = 0.15;
/** Les prix en francs CFA sont arrondis au multiple de ce montant le plus proche. */
export const CFA_ROUNDING = 500;
/** Remise du paiement à l'année (12 mois), déjà annoncée sur le site. Elle se cumule avec le rabais local. */
export const YEARLY_DISCOUNT = 0.2;

/** Essai gratuit à la création du premier espace (la base le pose : voir `start_trial`). */
export const TRIAL_DAYS = 14;
/** Après la fin d'une période prépayée par mobile money, l'offre reste applicable ce nombre de jours (la base le pose : `billing_settle_payment`). */
export const PREPAID_GRACE_DAYS = 7;
/** Jours avant la fin d'une période prépayée où l'on prévient les administrateurs de l'espace. */
export const REMINDER_DAYS = [7, 3, 1] as const;

/** Un dépôt mobile money non terminé est abandonné par PawaPay au bout de 15 minutes : on ne le relit plus après ce délai. */
export const DEPOSIT_PENDING_MINUTES = 20;

export function usdPerEur(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.BILLING_USD_PER_EUR);
  return Number.isFinite(n) && n > 0.5 && n < 3 ? n : USD_PER_EUR_REFERENCE;
}
