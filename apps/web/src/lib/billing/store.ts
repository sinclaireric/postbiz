import type { SupabaseClient } from '@supabase/supabase-js';
import type { BillingStore, PaymentRow, StripePaymentRecord, StripeSubState } from './service.ts';

// Implémentation Supabase du stockage de facturation. À utiliser UNIQUEMENT avec le client service_role (côté serveur) : les écritures de
// paiements et d'abonnements sont fermées aux clients par la base. Les règles (idempotence, montants, périodes) sont dans les fonctions SQL
// `billing_*`, testées dans packages/db avec PGlite.

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`${what} : ${error.message}`);
};

type Row = { org_id: string; provider: PaymentRow['provider']; provider_ref: string; plan: PaymentRow['plan']; months: number; amount: string | number; currency: string; status: PaymentRow['status']; created_at: string };
const COLUMNS = 'org_id, provider, provider_ref, plan, months, amount, currency, status, created_at';
const toRow = (r: Row): PaymentRow => ({
  orgId: r.org_id, provider: r.provider, providerRef: r.provider_ref, plan: r.plan, months: r.months, amount: Number(r.amount), currency: r.currency, status: r.status, createdAt: r.created_at,
});

export function createSupabaseBillingStore(admin: SupabaseClient): BillingStore {
  return {
    async createPending(p) {
      const { error } = await admin.from('payments').insert({
        org_id: p.orgId, user_id: p.userId, provider: 'pawapay', provider_ref: p.ref, plan: p.plan, billing_interval: p.interval, months: p.interval === 'yearly' ? 12 : 1,
        amount: p.amount, currency: p.currency, usd_amount: p.usdAmount, country: p.country, status: 'pending',
      });
      check(error, 'enregistrement du paiement');
    },

    async getPayment(provider, ref) {
      const { data, error } = await admin.from('payments').select(COLUMNS).eq('provider', provider).eq('provider_ref', ref).maybeSingle();
      check(error, 'lecture du paiement');
      return data ? toRow(data as Row) : null;
    },

    async pendingPayments(olderThanMinutes, limit) {
      const before = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
      const { data, error } = await admin.from('payments').select(COLUMNS).eq('status', 'pending').eq('provider', 'pawapay').lt('created_at', before).order('created_at').limit(limit);
      check(error, 'lecture des paiements en attente');
      return ((data ?? []) as Row[]).map(toRow);
    },

    async settle(ref, amount, currency) {
      const { data, error } = await admin.rpc('billing_settle_payment', { p_provider: 'pawapay', p_ref: ref, p_amount: amount, p_currency: currency });
      check(error, 'règlement du paiement');
      const r = (data ?? {}) as { result?: string; org_id?: string };
      return { result: (r.result ?? 'unknown') as 'ok', orgId: r.org_id };
    },

    async fail(ref, reason, expired) {
      const { data, error } = await admin.rpc('billing_fail_payment', { p_provider: 'pawapay', p_ref: ref, p_reason: reason, p_expired: expired });
      check(error, 'échec du paiement');
      return data === true;
    },

    async applyStripe(eventId: string, eventType: string, orgId: string, sub: StripeSubState | null, payment: StripePaymentRecord | null) {
      const { data, error } = await admin.rpc('billing_apply_stripe', { p_event_id: eventId, p_event_type: eventType, p_org: orgId, p_sub: sub, p_payment: payment });
      check(error, 'enregistrement de l’événement Stripe');
      return data as 'ok' | 'duplicate' | 'unknown_org';
    },
  };
}
