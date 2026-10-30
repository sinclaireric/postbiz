import { describe, expect, it, vi } from 'vitest';
import {
  confirmCheckoutSession, confirmMobileMoney, handleStripeEvent, invoicePayment, reconcilePending, returnBase, startCardCheckout, startMobileMoney, startPortal, subscriptionState,
  type BillingStore, type NewPendingPayment, type PaymentRow, type StripePaymentRecord, type StripeSubState,
} from './service.ts';

const NOW = new Date('2026-11-01T12:00:00Z');
const pawapay = { token: 't', env: 'sandbox' as const, baseUrl: 'https://api.sandbox.pawapay.io' };
const stripeCfg = { secretKey: 'sk_test_x', mode: 'test' as const, webhookSecrets: [] };

/** Fausse base : mêmes règles que les fonctions SQL pour ce que les tests observent (idempotence, montant, états). */
function fakeStore() {
  const payments = new Map<string, PaymentRow & { userId?: string | null }>();
  const events = new Set<string>();
  const applied: { eventId: string; org: string; sub: StripeSubState | null; payment: StripePaymentRecord | null }[] = [];
  const settleCalls: { ref: string; amount: number; currency: string }[] = [];
  const store: BillingStore = {
    async createPending(p: NewPendingPayment) {
      payments.set(p.ref, { orgId: p.orgId, provider: 'pawapay', providerRef: p.ref, plan: p.plan, months: p.interval === 'yearly' ? 12 : 1, amount: p.amount, currency: p.currency, status: 'pending', createdAt: NOW.toISOString(), userId: p.userId });
    },
    async getPayment(provider, ref) {
      const r = payments.get(ref);
      return r && r.provider === provider ? { ...r } : null;
    },
    async pendingPayments(minutes, limit) {
      return [...payments.values()].filter((p) => p.status === 'pending' && NOW.getTime() - new Date(p.createdAt).getTime() >= minutes * 60_000).slice(0, limit);
    },
    async settle(ref, amount, currency) {
      settleCalls.push({ ref, amount, currency });
      const r = payments.get(ref);
      if (!r) return { result: 'unknown' };
      if (r.status === 'succeeded') return { result: 'already', orgId: r.orgId };
      if (amount !== r.amount || currency !== r.currency) { r.status = 'failed'; return { result: 'mismatch', orgId: r.orgId }; }
      r.status = 'succeeded';
      return { result: 'ok', orgId: r.orgId };
    },
    async fail(ref, _reason, expired) {
      const r = payments.get(ref);
      if (!r || r.status !== 'pending') return false;
      r.status = expired ? 'expired' : 'failed';
      return true;
    },
    async applyStripe(eventId, _type, org, sub, payment) {
      if (events.has(eventId)) return 'duplicate';
      events.add(eventId);
      applied.push({ eventId, org, sub, payment });
      return 'ok';
    },
  };
  return { store, payments, applied, settleCalls };
}

type Handler = (url: string, init: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
function route(handler: Handler) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const r = await handler(String(url), init);
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body } as unknown as Response;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------- mobile money

const mm = (over: Record<string, unknown> = {}) => ({
  orgId: 'org-1', userId: 'user-1', plan: 'standard', interval: 'monthly', country: 'CM', language: 'FR' as const, planLabel: 'Standard', phone: null, ...over,
});
const mmDeps = (store: BillingStore, f: typeof fetch, over: Record<string, unknown> = {}) => ({
  store, pawapay, fetch: f, siteUrl: 'https://getpostbiz.com', uuid: () => '3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e10', now: () => NOW, ...over,
});

describe('mobile money : démarrer un paiement', () => {
  it('enregistre le dépôt AVANT l’appel, puis renvoie la page de paiement au bon montant', async () => {
    const { store, payments } = fakeStore();
    let rowWhenCalled: PaymentRow | undefined;
    const f = route((url, init) => {
      rowWhenCalled = payments.get('3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e10');
      expect(url).toBe('https://api.sandbox.pawapay.io/v2/paymentpage');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ depositId: '3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e10', amountDetails: { amount: '9500', currency: 'XAF' }, country: 'CMR', language: 'FR' });
      expect(body.returnUrl).toBe('https://getpostbiz.com/app/facturation/retour?depositId=3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e10');
      expect(body.metadata).toEqual([{ orgId: 'org-1' }, { plan: 'standard' }, { interval: 'monthly' }, { userId: 'user-1' }]);
      return { body: { redirectUrl: 'https://pay.pawapay.io/s/abc' } };
    });
    const r = await startMobileMoney(mmDeps(store, f), mm());
    expect(r).toEqual({ ok: true, url: 'https://pay.pawapay.io/s/abc', depositId: '3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e10' });
    expect(rowWhenCalled).toMatchObject({ status: 'pending', amount: 9500, currency: 'XAF', plan: 'standard', months: 1 });
  });

  it('douze mois : prix annuel de la zone', async () => {
    const { store, payments } = fakeStore();
    const f = route(() => ({ body: { redirectUrl: 'https://pay.pawapay.io/s/y' } }));
    await startMobileMoney(mmDeps(store, f), mm({ plan: 'agency', interval: 'yearly', country: 'SN' }));
    expect([...payments.values()][0]).toMatchObject({ amount: 379000, currency: 'XOF', months: 12 });
  });

  it('refuse sans appeler PawaPay : offre inconnue, offre gratuite, pays sans mobile money (Tchad, Togo, France), adresse de retour non sécurisée', async () => {
    const { store, payments } = fakeStore();
    const f = route(() => ({ body: {} }));
    expect(await startMobileMoney(mmDeps(store, f), mm({ plan: 'free' }))).toEqual({ ok: false, reason: 'plan' });
    expect(await startMobileMoney(mmDeps(store, f), mm({ plan: 'platine' }))).toEqual({ ok: false, reason: 'plan' });
    expect(await startMobileMoney(mmDeps(store, f), mm({ interval: 'weekly' }))).toEqual({ ok: false, reason: 'plan' });
    for (const country of ['TD', 'TG', 'FR', null, 'CD']) expect(await startMobileMoney(mmDeps(store, f), mm({ country })), String(country)).toEqual({ ok: false, reason: 'country' });
    expect(await startMobileMoney(mmDeps(store, f, { siteUrl: 'http://localhost:3100' }), mm())).toEqual({ ok: false, reason: 'return_url' });
    expect(f).not.toHaveBeenCalled();
    expect(payments.size).toBe(0);
  });

  it('en local, l’adresse de retour https de remplacement permet de tester', async () => {
    expect(returnBase('http://localhost:3100', 'https://exemple.test/')).toBe('https://exemple.test');
    expect(returnBase('https://getpostbiz.com/', null)).toBe('https://getpostbiz.com');
    expect(returnBase('http://localhost:3100', null)).toBeNull();
    const { store } = fakeStore();
    const f = route((_u, init) => {
      expect(JSON.parse(String(init.body)).returnUrl).toMatch(/^https:\/\/exemple\.test\/app\/facturation\/retour/);
      return { body: { redirectUrl: 'https://pay.pawapay.io/s/l' } };
    });
    expect((await startMobileMoney(mmDeps(store, f, { siteUrl: 'http://localhost:3100', returnBaseUrl: 'https://exemple.test' }), mm())).ok).toBe(true);
  });

  it('un pays activé plus tard (liste fournie par PawaPay) est accepté', async () => {
    const { store } = fakeStore();
    const f = route(() => ({ body: { redirectUrl: 'https://pay.pawapay.io/s/cd' } }));
    const r = await startMobileMoney(mmDeps(store, f, { countries: ['CD'] }), mm({ country: 'CD' }));
    expect(r.ok).toBe(true);
  });

  it('numéro invalide : refusé ; refus de PawaPay : le dépôt est marqué échoué, sans activer quoi que ce soit', async () => {
    const { store, payments } = fakeStore();
    expect(await startMobileMoney(mmDeps(store, route(() => ({ body: {} }))), mm({ phone: '12' }))).toEqual({ ok: false, reason: 'phone' });
    const f = route(() => ({ status: 400, body: { failureReason: { failureCode: 'INVALID_PHONE_NUMBER' } } }));
    expect(await startMobileMoney(mmDeps(store, f), mm())).toEqual({ ok: false, reason: 'provider', transient: false });
    expect([...payments.values()][0]!.status).toBe('failed');
  });
});

describe('mobile money : relire le dépôt chez PawaPay', () => {
  const ID = '3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e10';
  const pending = async (over: Partial<PaymentRow> = {}) => {
    const s = fakeStore();
    await s.store.createPending({ orgId: 'org-1', userId: null, ref: ID, plan: 'standard', interval: 'monthly', amount: 9500, currency: 'XAF', usdAmount: 16.21, country: 'CM' });
    Object.assign(s.payments.get(ID)!, over);
    return s;
  };
  const dep = (status: string, extra: Record<string, unknown> = {}) => ({ status: 'FOUND', data: { depositId: ID, status, amount: '9500.00', currency: 'XAF', country: 'CMR', metadata: { orgId: 'org-1' }, ...extra } });
  const confirm = (s: ReturnType<typeof fakeStore>, f: typeof fetch) => confirmMobileMoney({ store: s.store, pawapay, fetch: f, now: () => NOW }, ID);

  it('active l’offre seulement si PawaPay confirme COMPLETED, avec SON montant et SA monnaie', async () => {
    const s = await pending();
    expect(await confirm(s, route(() => ({ body: dep('COMPLETED') })))).toBe('succeeded');
    expect(s.settleCalls).toEqual([{ ref: ID, amount: 9500, currency: 'XAF' }]);
    expect(s.payments.get(ID)!.status).toBe('succeeded');
  });

  it('est idempotent : un rappel rejoué, ou un retour affiché deux fois, ne relit ni ne règle rien de plus', async () => {
    const s = await pending();
    const f = route(() => ({ body: dep('COMPLETED') }));
    await confirm(s, f);
    expect(await confirm(s, f)).toBe('succeeded');
    expect(await confirm(s, f)).toBe('succeeded');
    expect(s.settleCalls).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('un dépôt payé moins que le prix est refusé et ne donne rien', async () => {
    const s = await pending();
    expect(await confirm(s, route(() => ({ body: dep('COMPLETED', { amount: '100' }) })))).toBe('failed');
    expect(s.payments.get(ID)!.status).toBe('failed');
  });

  it('des métadonnées d’une autre organisation sont refusées', async () => {
    const s = await pending();
    expect(await confirm(s, route(() => ({ body: dep('COMPLETED', { metadata: { orgId: 'org-pirate' } }) })))).toBe('failed');
    expect(s.settleCalls).toHaveLength(0);
  });

  it('échec confirmé : marqué échoué ; en cours : rien ne change', async () => {
    const a = await pending();
    expect(await confirm(a, route(() => ({ body: dep('FAILED', { failureReason: { failureCode: 'PAYMENT_NOT_APPROVED' } }) })))).toBe('failed');
    expect(a.payments.get(ID)!.status).toBe('failed');
    for (const status of ['ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION']) {
      const b = await pending();
      expect(await confirm(b, route(() => ({ body: dep(status) })))).toBe('pending');
      expect(b.payments.get(ID)!.status).toBe('pending');
    }
  });

  it('introuvable chez PawaPay : en attente tant que la page peut encore servir, expiré ensuite', async () => {
    const young = await pending({ createdAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() });
    expect(await confirm(young, route(() => ({ body: { status: 'NOT_FOUND' } })))).toBe('pending');
    expect(young.payments.get(ID)!.status).toBe('pending');
    const old = await pending({ createdAt: new Date(NOW.getTime() - 25 * 60_000).toISOString() });
    expect(await confirm(old, route(() => ({ body: { status: 'NOT_FOUND' } })))).toBe('expired');
    expect(old.payments.get(ID)!.status).toBe('expired');
  });

  it('une panne de PawaPay ne marque JAMAIS un paiement comme échoué', async () => {
    for (const f of [route(() => ({ status: 500, body: null })), route(() => ({ status: 401, body: { errorCode: 'x' } })), route(() => ({ body: { surprise: true } })), vi.fn(async () => { throw new Error('réseau'); }) as unknown as typeof fetch]) {
      const s = await pending({ createdAt: new Date(NOW.getTime() - 60 * 60_000).toISOString() });
      expect(await confirm(s, f)).toBe('error');
      expect(s.payments.get(ID)!.status).toBe('pending');
    }
  });

  it('un dépôt inconnu de notre base n’est pas relu ; un paiement déjà clos garde son état', async () => {
    const s = fakeStore();
    const f = route(() => ({ body: dep('COMPLETED') }));
    expect(await confirm(s, f)).toBe('unknown');
    expect(f).not.toHaveBeenCalled();
    for (const [status, out] of [['failed', 'failed'], ['expired', 'expired'], ['refunded', 'failed']] as const) {
      const c = await pending({ status });
      expect(await confirm(c, f)).toBe(out);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('le rapprochement traite les dépôts en attente depuis plus de 3 minutes, un par un, sans qu’un échec bloque les autres', async () => {
    const s = fakeStore();
    for (const [i, age] of [[1, 10], [2, 10], [3, 1]] as const) {
      const ref = `3f6f0b0e-2b6a-4d6e-9b53-2c1d4f7a9e0${i}`;
      await s.store.createPending({ orgId: 'org-1', userId: null, ref, plan: 'standard', interval: 'monthly', amount: 9500, currency: 'XAF', usdAmount: 16.21, country: 'CM' });
      s.payments.get(ref)!.createdAt = new Date(NOW.getTime() - age * 60_000).toISOString();
    }
    const f = route((url) => (url.endsWith('01') ? { body: dep('COMPLETED') } : { status: 500, body: null }));
    expect(await reconcilePending({ store: s.store, pawapay, fetch: f, now: () => NOW })).toMatchObject({ succeeded: 1, error: 1, pending: 0 });
  });
});

// ---------------------------------------------------------------- Stripe

const subObj = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', currency: 'usd', cancel_at_period_end: false,
  metadata: { postbiz_org_id: 'org-1', postbiz_plan: 'team', postbiz_user_id: 'user-1', postbiz_country: 'FR' },
  items: { data: [{ current_period_end: 1_800_000_000, price: { currency: 'usd', unit_amount: 3900, recurring: { interval: 'month' } } }] }, ...over,
});
const invObj = (over: Record<string, unknown> = {}) => ({
  id: 'in_1', subscription: 'sub_1', amount_paid: 3900, currency: 'usd', status: 'paid', lines: { data: [{ period: { start: 1_797_400_000, end: 1_800_000_000 } }] }, ...over,
});
const evt = (type: string, object: unknown, id = 'evt_1') => ({ id, type, data: { object } });
const stripeApi = (sub: unknown) => route((url) => (url.includes('/v1/subscriptions/') ? { body: sub } : { status: 404, body: { error: { code: 'resource_missing' } } }));

describe('Stripe : lecture d’un abonnement', () => {
  it('abonnement de Postbiz → état à recopier (prix mensuel en dollars compris)', () => {
    const s = subscriptionState(subObj())!;
    expect(s.orgId).toBe('org-1');
    expect(s.userId).toBe('user-1');
    expect(s.state).toEqual({
      plan: 'team', status: 'active', interval: 'monthly', current_period_end: new Date(1_800_000_000 * 1000).toISOString(), cancel_at_period_end: false,
      customer: 'cus_1', subscription: 'sub_1', currency: 'USD', country: 'FR', monthly_usd: 39,
    });
  });

  it('annuel en francs CFA : MRR = prix annuel converti ÷ 12', () => {
    const s = subscriptionState(subObj({ currency: 'xof', items: { data: [{ current_period_end: 1_800_000_000, price: { currency: 'xof', unit_amount: 187000, recurring: { interval: 'year' } } }] } }))!;
    expect(s.state).toMatchObject({ interval: 'yearly', currency: 'XOF' });
    expect(s.state.monthly_usd).toBeCloseTo(((187000 / 655.957) * 1.1193) / 12, 1);
  });

  it('statuts : actif/essai → active, impayé → past_due, résilié → canceled, incomplet → ignoré', () => {
    const st = (status: string) => subscriptionState(subObj({ status }))?.state.status ?? null;
    expect([st('active'), st('trialing'), st('past_due'), st('unpaid'), st('canceled'), st('incomplete_expired'), st('incomplete')]).toEqual(['active', 'active', 'past_due', 'past_due', 'canceled', 'canceled', null]);
  });

  it('annulation programmée, en ancienne (cancel_at_period_end) et nouvelle (cancel_at) forme', () => {
    expect(subscriptionState(subObj({ cancel_at_period_end: true }))!.state.cancel_at_period_end).toBe(true);
    expect(subscriptionState(subObj({ cancel_at: 1_800_000_000 }))!.state.cancel_at_period_end).toBe(true);
    expect(subscriptionState(subObj({ cancel_at: null }))!.state.cancel_at_period_end).toBe(false);
  });

  it('un abonnement qui n’est pas de Postbiz (même compte Stripe, autre site) est ignoré', () => {
    expect(subscriptionState(subObj({ metadata: {} }))).toBeNull();
    expect(subscriptionState(subObj({ metadata: { postbiz_org_id: 'o', postbiz_plan: 'free' } }))).toBeNull();
    expect(subscriptionState(subObj({ metadata: { type: 'subscription', slug: 'tcf-canada', plan: '1 mois' } }))).toBeNull();
    expect(subscriptionState(null)).toBeNull();
  });

  it('facture payée → paiement (centimes → dollars), jamais pour un montant nul', () => {
    const s = subscriptionState(subObj())!;
    expect(invoicePayment(invObj(), s)).toMatchObject({ invoice: 'in_1', amount: 39, currency: 'USD', usd_amount: 39, plan: 'team', interval: 'monthly', user_id: 'user-1' });
    expect(invoicePayment(invObj({ amount_paid: 0 }), s)).toBeNull();
    expect(invoicePayment(invObj({ id: undefined }), s)).toBeNull();
    const cfa = invoicePayment(invObj({ amount_paid: 19500, currency: 'xaf' }), s)!;
    expect(cfa).toMatchObject({ amount: 19500, currency: 'XAF' });
  });
});

describe('Stripe : événements', () => {
  it('invoice.paid : relit l’abonnement, enregistre l’état et la facture en une fois', async () => {
    const { store, applied } = fakeStore();
    const f = stripeApi(subObj());
    expect(await handleStripeEvent({ store, cfg: stripeCfg, fetch: f }, evt('invoice.paid', invObj()))).toBe('ok');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ eventId: 'evt_1', org: 'org-1', sub: { plan: 'team', status: 'active' }, payment: { invoice: 'in_1', amount: 39 } });
    expect(f.mock.calls[0]![0]).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
  });

  it('un événement relivré est reconnu (idempotence par identifiant)', async () => {
    const { store, applied } = fakeStore();
    const deps = { store, cfg: stripeCfg, fetch: stripeApi(subObj()) };
    expect(await handleStripeEvent(deps, evt('invoice.paid', invObj(), 'evt_9'))).toBe('ok');
    expect(await handleStripeEvent(deps, evt('invoice.paid', invObj(), 'evt_9'))).toBe('duplicate');
    expect(applied).toHaveLength(1);
  });

  it('l’ordre des livraisons est sans effet : l’état vient de l’abonnement relu, pas de l’événement', async () => {
    const { store, applied } = fakeStore();
    // L'événement « updated » porte un état ancien (past_due) ; Stripe répond maintenant « active ».
    const f = stripeApi(subObj({ status: 'active' }));
    await handleStripeEvent({ store, cfg: stripeCfg, fetch: f }, evt('customer.subscription.updated', subObj({ status: 'past_due' })));
    expect(applied[0]!.sub!.status).toBe('active');
  });

  it('résiliation : utilise l’objet de l’événement sans le relire', async () => {
    const { store, applied } = fakeStore();
    const f = route(() => ({ body: {} }));
    await handleStripeEvent({ store, cfg: stripeCfg, fetch: f }, evt('customer.subscription.deleted', subObj({ status: 'canceled' })));
    expect(applied[0]!.sub!.status).toBe('canceled');
    expect(f).not.toHaveBeenCalled();
  });

  it('checkout.session.completed d’un abonnement : état seul ; paiement unique d’un autre site : ignoré', async () => {
    const { store, applied } = fakeStore();
    const deps = { store, cfg: stripeCfg, fetch: stripeApi(subObj()) };
    expect(await handleStripeEvent(deps, evt('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1' }))).toBe('ok');
    expect(applied[0]!.payment).toBeNull();
    expect(await handleStripeEvent(deps, evt('checkout.session.completed', { mode: 'payment', metadata: { ref: 'abc' } }, 'evt_2'))).toBe('ignored');
    expect(applied).toHaveLength(1);
  });

  it('événements sans rapport, ou d’un autre site du compte, ignorés sans erreur', async () => {
    const { store, applied } = fakeStore();
    const deps = { store, cfg: stripeCfg, fetch: stripeApi(subObj({ metadata: { type: 'subscription' } })) };
    expect(await handleStripeEvent(deps, evt('charge.refunded', {}))).toBe('ignored');
    expect(await handleStripeEvent(deps, evt('invoice.paid', invObj(), 'evt_3'))).toBe('ignored');
    expect(await handleStripeEvent(deps, evt('invoice.paid', { id: 'in_x' }, 'evt_4'))).toBe('ignored');
    expect(await handleStripeEvent(deps, { type: 'invoice.paid' })).toBe('ignored');
    expect(applied).toHaveLength(0);
  });

  it('abonnement introuvable chez Stripe : ignoré ; panne passagère : erreur, pour que Stripe relivre', async () => {
    const { store } = fakeStore();
    expect(await handleStripeEvent({ store, cfg: stripeCfg, fetch: route(() => ({ status: 404, body: { error: { code: 'resource_missing' } } })) }, evt('invoice.paid', invObj()))).toBe('ignored');
    await expect(handleStripeEvent({ store, cfg: stripeCfg, fetch: route(() => ({ status: 503, body: null })) }, evt('invoice.paid', invObj()))).rejects.toThrow(/illisible/);
    await expect(handleStripeEvent({ store, cfg: stripeCfg, fetch: route(() => ({ status: 429, body: null })) }, evt('customer.subscription.updated', subObj()))).rejects.toThrow(/illisible/);
  });
});

describe('Stripe : démarrer un abonnement par carte', () => {
  const req = (over: Record<string, unknown> = {}) => ({ orgId: 'org-1', userId: 'user-1', email: 'a@b.test', plan: 'team', interval: 'monthly', country: 'FR', ...over });

  function api(opts: { productExists?: boolean; rejectCfa?: boolean } = {}) {
    const calls: { url: string; method: string; form: URLSearchParams }[] = [];
    const f = route((url, init) => {
      const form = new URLSearchParams(String(init?.body ?? ''));
      calls.push({ url, method: String(init?.method), form });
      if (url.endsWith('/v1/products/postbiz_team') || url.endsWith('/v1/products/postbiz_standard') || url.endsWith('/v1/products/postbiz_agency')) {
        return opts.productExists === false ? { status: 404, body: { error: { code: 'resource_missing' } } } : { body: { id: 'prod' } };
      }
      if (url.endsWith('/v1/products')) return { body: { id: form.get('id') } };
      if (url.endsWith('/v1/checkout/sessions')) {
        if (opts.rejectCfa && /^(xaf|xof)$/.test(form.get('line_items[0][price_data][currency]') ?? '')) return { status: 400, body: { error: { code: 'parameter_invalid_empty', message: 'Invalid currency: xof' } } };
        return { body: { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' } };
      }
      return { status: 404, body: {} };
    });
    return { f, calls };
  }
  const session = (calls: { url: string; form: URLSearchParams }[]) => calls.filter((c) => c.url.endsWith('/v1/checkout/sessions')).at(-1)!.form;

  it('crée une session d’abonnement avec le prix de la grille, le produit de l’offre et les métadonnées de l’espace', async () => {
    const { f, calls } = api();
    const r = await startCardCheckout({ cfg: stripeCfg, siteUrl: 'https://getpostbiz.com', fetch: f }, req());
    expect(r).toEqual({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const form = session(calls);
    expect(form.get('mode')).toBe('subscription');
    expect(form.get('line_items[0][price_data][product]')).toBe('postbiz_team');
    expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('3900');
    expect(form.get('line_items[0][price_data][recurring][interval]')).toBe('month');
    expect(form.get('metadata[postbiz_org_id]')).toBe('org-1');
    expect(form.get('subscription_data[metadata][postbiz_org_id]')).toBe('org-1');
    expect(form.get('subscription_data[metadata][postbiz_plan]')).toBe('team');
    expect(form.get('subscription_data[metadata][postbiz_country]')).toBe('FR');
    expect(form.get('client_reference_id')).toBe('org-1');
    expect(form.get('customer_email')).toBe('a@b.test');
    expect(form.get('success_url')).toBe('https://getpostbiz.com/app/facturation?paiement=ok&session_id={CHECKOUT_SESSION_ID}');
    expect(form.get('cancel_url')).toBe('https://getpostbiz.com/app/facturation?paiement=annule');
  });

  it('Afrique francophone : prix en francs CFA avec le rabais, à l’année', async () => {
    const { f, calls } = api();
    await startCardCheckout({ cfg: stripeCfg, siteUrl: 'https://getpostbiz.com', fetch: f }, req({ country: 'TD', interval: 'yearly' }));
    const form = session(calls);
    expect(form.get('line_items[0][price_data][currency]')).toBe('xaf');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('187000');
    expect(form.get('line_items[0][price_data][recurring][interval]')).toBe('year');
  });

  it('un client Stripe existant est réutilisé (pas d’e-mail en double)', async () => {
    const { f, calls } = api();
    await startCardCheckout({ cfg: stripeCfg, siteUrl: 'https://getpostbiz.com', fetch: f }, req({ customerId: 'cus_77' }));
    expect(session(calls).get('customer')).toBe('cus_77');
    expect(session(calls).get('customer_email')).toBeNull();
  });

  it('crée le produit de l’offre s’il manque, avec un identifiant fixe', async () => {
    const { f, calls } = api({ productExists: false });
    await startCardCheckout({ cfg: stripeCfg, siteUrl: 'https://getpostbiz.com', fetch: f }, req());
    const made = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/products'))!;
    expect(made.form.get('id')).toBe('postbiz_team');
    expect(made.form.get('metadata[postbiz_plan]')).toBe('team');
  });

  it('si le compte Stripe refuse les francs CFA, repli sur le même tarif africain en dollars', async () => {
    const { f, calls } = api({ rejectCfa: true });
    const r = await startCardCheckout({ cfg: stripeCfg, siteUrl: 'https://getpostbiz.com', fetch: f }, req({ country: 'CM' }));
    expect(r.ok).toBe(true);
    const form = session(calls);
    expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('3300'); // 39 $ − 15 % = 33 $
  });

  it('offre invalide, ou Stripe en panne : refus sans lever', async () => {
    const { f } = api();
    expect(await startCardCheckout({ cfg: stripeCfg, siteUrl: 'https://x.test', fetch: f }, req({ plan: 'free' }))).toEqual({ ok: false, reason: 'plan' });
    const down = route(() => ({ status: 503, body: null }));
    expect(await startCardCheckout({ cfg: stripeCfg, siteUrl: 'https://x.test', fetch: down }, req())).toMatchObject({ ok: false, reason: 'provider', transient: true });
  });

  it('portail client', async () => {
    const f = route((_u, init) => {
      expect(new URLSearchParams(String(init.body)).get('customer')).toBe('cus_1');
      return { body: { url: 'https://billing.stripe.com/p/session/x' } };
    });
    expect(await startPortal({ cfg: stripeCfg, siteUrl: 'https://getpostbiz.com', fetch: f }, 'cus_1')).toEqual({ ok: true, url: 'https://billing.stripe.com/p/session/x' });
    expect(await startPortal({ cfg: stripeCfg, siteUrl: 'https://getpostbiz.com', fetch: route(() => ({ status: 400, body: {} })) }, 'cus_1')).toEqual({ ok: false });
  });
});

describe('Stripe : retour sur le site après le paiement', () => {
  const sessionObj = (over: Record<string, unknown> = {}) => ({ id: 'cs_test_abc', status: 'complete', mode: 'subscription', subscription: 'sub_1', invoice: 'in_1', metadata: { postbiz_org_id: 'org-1' }, ...over });
  const api = (session: unknown, invoice: unknown = invObj()) =>
    route((url) => (url.includes('/checkout/sessions/') ? { body: session } : url.includes('/invoices/') ? { body: invoice } : url.includes('/subscriptions/') ? { body: subObj() } : { status: 404, body: {} }));

  it('confirme la session pour son espace et enregistre abonnement et première facture, sans attendre le webhook', async () => {
    const { store, applied } = fakeStore();
    expect(await confirmCheckoutSession({ store, cfg: stripeCfg, fetch: api(sessionObj()) }, 'cs_test_abc', 'org-1')).toBe('ok');
    expect(applied[0]).toMatchObject({ eventId: 'return:cs_test_abc', org: 'org-1', payment: { invoice: 'in_1' } });
  });

  it('refuse la session d’un autre espace ou un identifiant mal formé ; attend une session non terminée', async () => {
    const { store, applied } = fakeStore();
    expect(await confirmCheckoutSession({ store, cfg: stripeCfg, fetch: api(sessionObj()) }, 'cs_test_abc', 'org-2')).toBe('foreign');
    expect(await confirmCheckoutSession({ store, cfg: stripeCfg, fetch: api(sessionObj()) }, '../../x', 'org-1')).toBe('foreign');
    expect(await confirmCheckoutSession({ store, cfg: stripeCfg, fetch: api(sessionObj({ status: 'open' })) }, 'cs_test_abc', 'org-1')).toBe('pending');
    expect(await confirmCheckoutSession({ store, cfg: stripeCfg, fetch: route(() => ({ status: 500, body: null })) }, 'cs_test_abc', 'org-1')).toBe('error');
    expect(applied).toHaveLength(0);
  });

  it('un retour rejoué, puis le webhook qui arrive, ne comptent qu’une fois chacun côté base', async () => {
    const { store } = fakeStore();
    const deps = { store, cfg: stripeCfg, fetch: api(sessionObj()) };
    expect(await confirmCheckoutSession(deps, 'cs_test_abc', 'org-1')).toBe('ok');
    expect(await confirmCheckoutSession(deps, 'cs_test_abc', 'org-1')).toBe('ok'); // duplicate → ok
  });
});
