import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, asAnon, asService, asUser, createDb, createUser, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;
let owner: string; // propriétaire de la plateforme

const enable = (on: boolean) => q(db, 'update public.billing_settings set enabled = $1', [on]);
const sub = async (org: string) => (await q<any>(db, `select * from public.subscriptions where org_id = $1`, [org]))[0];
const limit = (user: string, org: string, key: string) =>
  asUser(db, user, () => q<{ v: number | null }>(db, 'select public.org_plan_limit($1, $2) as v', [org, key])).then((r) => r[0]!.v);
const effective = async (org: string) =>
  (await q<{ p: string }>(db, `select public.org_plan($1) as p`, [org]))[0]!.p;
const setSub = (org: string, set: string, params: unknown[] = []) =>
  q(db, `update public.subscriptions set ${set} where org_id = $${params.length + 1}`, [...params, org]);
const newOrg = async (email: string, name = 'Espace') => {
  const user = await createUser(db, email);
  const org = await asUser(db, user, async () => (await q<{ id: string }>(db, `select public.create_organization($1) as id`, [name]))[0]!.id);
  return { user, org };
};

let seq = 0;
async function pending(org: string, over: Partial<{ ref: string; plan: string; months: number; amount: number; currency: string; usd: number; country: string; user: string | null }> = {}) {
  const ref = over.ref ?? `dep-${++seq}`;
  await q(db,
    `insert into public.payments (org_id, user_id, provider, provider_ref, plan, billing_interval, months, amount, currency, usd_amount, country)
     values ($1, $2, 'pawapay', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [org, over.user ?? null, ref, over.plan ?? 'standard', (over.months ?? 1) >= 12 ? 'yearly' : 'monthly', over.months ?? 1, over.amount ?? 9500, over.currency ?? 'XAF', over.usd ?? 16.15, over.country ?? 'CM']);
  return ref;
}
const settle = (ref: string, amount = 9500, currency = 'XAF') =>
  asService(db, () => q<{ r: any }>(db, `select public.billing_settle_payment('pawapay', $1, $2, $3) as r`, [ref, amount, currency])).then((r) => r[0]!.r);
const days = (ts: string | Date) => (new Date(ts).getTime() - Date.now()) / 86_400_000;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
  owner = await createUser(db, 'owner@postbiz.test');
  await asService(db, () => q(db, 'insert into public.platform_admins (user_id) values ($1)', [owner]));
});

describe('migration', () => {
  it('reprend les anciennes offres : starter → free, pro → standard, team inchangée', async () => {
    const old = await createDb({ before: '20261103000001_billing.sql' });
    const a = await createUser(old, 'a@x.test');
    const orgs: string[] = [];
    for (const n of ['A', 'B', 'C']) orgs.push(await asUser(old, a, async () => (await q<{ id: string }>(old, `select public.create_organization($1) as id`, [n]))[0]!.id));
    await q(old, `update public.subscriptions set plan = 'starter' where org_id = $1`, [orgs[1]]);
    await q(old, `update public.subscriptions set plan = 'team', status = 'active', trial_ends_at = null, current_period_end = now() + interval '5 days' where org_id = $1`, [orgs[2]]);
    await applyMigration(old, '20261103000001_billing.sql');
    const rows = await q<{ org_id: string; plan: string; provider: string }>(old, `select org_id, plan, provider from public.subscriptions`);
    const by = Object.fromEntries(rows.map((r) => [r.org_id, r.plan]));
    expect(by).toEqual({ [orgs[0]!]: 'standard', [orgs[1]!]: 'free', [orgs[2]!]: 'team' });
  });

  it('une nouvelle organisation démarre un essai de 14 jours de l’offre Standard', async () => {
    const [s] = await q<{ plan: string; status: string; d: number }>(db,
      `select plan, status::text, round(extract(epoch from trial_ends_at - now()) / 86400)::int as d from public.subscriptions where org_id = $1`, [w.orgA]);
    expect(s).toEqual({ plan: 'standard', status: 'trialing', d: 14 });
  });

  it('les offres inconnues sont refusées', async () => {
    await expect(setSub(w.orgA, `plan = 'pro'`)).rejects.toThrow(/subscriptions_plan_check/);
  });
});

describe('offre applicable', () => {
  const f = (plan: string, status: string, trial: string | null, end: string | null, grace: string | null) =>
    q<{ p: string }>(db,
      `select public.subscription_effective_plan($1, $2::public.subscription_status, (${trial ?? 'null'})::timestamptz, (${end ?? 'null'})::timestamptz, (${grace ?? 'null'})::timestamptz) as p`, [plan, status])
      .then((r) => r[0]!.p);
  const future = `now() + interval '3 days'`;
  const past = `now() - interval '3 days'`;

  it('essai en cours : l’offre d’essai ; essai terminé : Gratuit', async () => {
    expect(await f('standard', 'trialing', future, null, null)).toBe('standard');
    expect(await f('standard', 'trialing', past, null, null)).toBe('free');
  });

  it('abonnement actif : l’offre jusqu’à la fin de période (ou sans fin), puis Gratuit', async () => {
    expect(await f('team', 'active', null, future, null)).toBe('team');
    expect(await f('team', 'active', null, null, null)).toBe('team');
    expect(await f('team', 'active', null, past, null)).toBe('free');
  });

  it('le délai de grâce garde l’offre payée, en retard ou non', async () => {
    expect(await f('team', 'active', null, past, future)).toBe('team');
    expect(await f('team', 'past_due', null, past, future)).toBe('team');
    expect(await f('team', 'past_due', null, past, past)).toBe('free');
  });

  it('un abonnement résilié ou absent donne Gratuit', async () => {
    expect(await f('team', 'canceled', null, future, future)).toBe('free');
    const { org } = await newOrg('nosub@x.test');
    await q(db, 'delete from public.subscriptions where org_id = $1', [org]);
    expect(await effective(org)).toBe('free');
  });
});

describe('interrupteur et limites', () => {
  it('facturation désactivée (bêta gratuite) : aucune limite', async () => {
    expect((await q<{ v: boolean }>(db, 'select public.billing_enabled() as v'))[0]!.v).toBe(false);
    expect(await limit(w.alice, w.orgA, 'channels')).toBeNull();
    expect(await limit(w.alice, w.orgA, 'images_per_month')).toBeNull();
  });

  it('seul le propriétaire de la plateforme active la facturation ; chacun peut lire l’état', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select public.admin_set_billing_enabled(true)'))).rejects.toThrow(/forbidden/);
    expect((await asAnon(db, () => q<{ v: boolean }>(db, 'select public.billing_enabled() as v')))[0]!.v).toBe(false);
    await expect(asUser(db, w.alice, () => q(db, 'update public.billing_settings set enabled = true'))).rejects.toThrow(/permission denied/);
    await asUser(db, owner, () => q(db, 'select public.admin_set_billing_enabled(true)'));
    expect((await asAnon(db, () => q<{ v: boolean }>(db, 'select public.billing_enabled() as v')))[0]!.v).toBe(true);
    await asUser(db, owner, () => q(db, 'select public.admin_set_billing_enabled(false)'));
    expect((await q<{ v: boolean }>(db, 'select public.billing_enabled() as v'))[0]!.v).toBe(false);
  });

  it('facturation activée : la limite suit l’offre applicable', async () => {
    await enable(true);
    try {
      expect(await limit(w.alice, w.orgA, 'channels')).toBe(5); // essai Standard
      await setSub(w.orgA, `trial_ends_at = now() - interval '1 day'`);
      expect(await limit(w.alice, w.orgA, 'channels')).toBe(3); // Gratuit
      await setSub(w.orgA, `status = 'active', plan = 'agency', trial_ends_at = null, current_period_end = now() + interval '9 days'`);
      expect(await limit(w.alice, w.orgA, 'channels')).toBe(100);
      expect(await limit(w.alice, w.orgA, 'members')).toBe(25);
    } finally {
      await setSub(w.orgA, `status = 'trialing', plan = 'standard', trial_ends_at = now() + interval '14 days', current_period_end = null`);
      await enable(false);
    }
  });

  it('un étranger à l’organisation ne lit pas ses limites ; une clé inconnue est refusée', async () => {
    await expect(limit(w.bob, w.orgA, 'channels')).rejects.toThrow(/forbidden/);
    await expect(limit(w.alice, w.orgA, 'bonus')).rejects.toThrow(/unknown plan limit/);
  });

  it('la grille des limites est lisible par tous et modifiable par personne', async () => {
    expect((await asAnon(db, () => q<{ n: number }>(db, 'select count(*)::int as n from public.plan_limits')))[0]!.n).toBe(36);
    await expect(asUser(db, owner, () => q(db, `update public.plan_limits set value = 999 where plan = 'free'`))).rejects.toThrow(/permission denied/);
    const rows = await q<{ plan: string; value: number }>(db, `select plan, value from public.plan_limits where key = 'channels' order by value`);
    expect(rows.map((r) => [r.plan, r.value])).toEqual([['free', 3], ['standard', 5], ['team', 30], ['agency', 100]]);
  });
});

describe('canaux : limite de l’offre', () => {
  const connect = (org: string, id: string) =>
    asService(db, () => q(db, `select public.connect_integration($1, 'facebook', $2, $2, null, null, '{}'::jsonb, null, 'enc', null)`, [org, id]));
  let org: string;

  beforeAll(async () => {
    org = (await newOrg('canaux@x.test')).org;
    await setSub(org, `trial_ends_at = now() - interval '1 day'`); // Gratuit : 3 canaux
    await enable(true);
  });

  it('refuse un nouveau canal au-delà de la limite, avec le code channel_limit', async () => {
    await connect(org, 'p1');
    await connect(org, 'p2');
    await connect(org, 'p3');
    await expect(connect(org, 'p4')).rejects.toThrow(/channel_limit/);
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.integrations where org_id = $1`, [org]))[0]!.n).toBe(3);
  });

  it('reconnecter un canal déjà actif reste permis à la limite', async () => {
    await connect(org, 'p2');
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.integrations where org_id = $1`, [org]))[0]!.n).toBe(3);
  });

  it('déconnecter libère une place ; réactiver un canal supprimé compte comme un nouveau', async () => {
    const [{ id }] = await q<{ id: string }>(db, `select id from public.integrations where org_id = $1 and internal_id = 'p1'`, [org]) as [{ id: string }];
    await asService(db, () => q(db, `select public.disconnect_integration($1, $2)`, [org, id]));
    await connect(org, 'p5');
    await expect(connect(org, 'p1')).rejects.toThrow(/channel_limit/);
  });

  it('un abonnement payant relève la limite', async () => {
    await setSub(org, `status = 'active', plan = 'standard', trial_ends_at = null, current_period_end = now() + interval '20 days'`);
    await connect(org, 'p6');
    await connect(org, 'p1');
    await expect(connect(org, 'p7')).rejects.toThrow(/channel_limit/);
  });

  it('sans facturation, aucune limite', async () => {
    await enable(false);
    await connect(org, 'p7');
    await connect(org, 'p8');
  });
});

describe('droits sur les paiements', () => {
  it('seuls les administrateurs de l’organisation lisent ses paiements', async () => {
    const ref = await pending(w.orgA);
    const seen = (user: string) => asUser(db, user, () => q<{ provider_ref: string }>(db, `select provider_ref from public.payments where provider_ref = $1`, [ref])).then((r) => r.length);
    expect(await seen(w.alice)).toBe(1);
    expect(await seen(w.carol)).toBe(0); // membre
    expect(await seen(w.dave)).toBe(0); // lecteur
    expect(await seen(w.bob)).toBe(0); // autre organisation
  });

  it('un client n’écrit ni paiement, ni événement, ni abonnement, ni réglage', async () => {
    await expect(asUser(db, w.alice, () => q(db,
      `insert into public.payments (org_id, provider, provider_ref, plan, billing_interval, amount, currency, usd_amount, status) values ($1, 'stripe', 'x', 'team', 'monthly', 1, 'USD', 1, 'succeeded')`, [w.orgA])))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.payments set status = 'succeeded'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `select * from public.billing_events`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.subscriptions set plan = 'agency'`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => q(db, `select * from public.payments`))).rejects.toThrow(/permission denied/);
  });

  it('un client ne règle pas lui-même un paiement', async () => {
    const ref = await pending(w.orgA);
    await expect(asUser(db, w.alice, () => q(db, `select public.billing_settle_payment('pawapay', $1, 9500, 'XAF')`, [ref]))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => q(db, `select public.billing_settle_payment('pawapay', $1, 9500, 'XAF')`, [ref]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `select public.billing_apply_stripe('e', 't', $1, null, null)`, [w.orgA]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `select public.billing_expire_lapsed()`))).rejects.toThrow(/permission denied/);
  });
});

describe('mobile money : règlement d’un paiement vérifié', () => {
  it('un dépôt inconnu ne change rien', async () => {
    expect((await settle('inconnu')).result).toBe('unknown');
  });

  it('un montant ou une devise différents du dépôt créé sont refusés, sans abonnement accordé', async () => {
    const { org } = await newOrg('mismatch@x.test');
    const before = await sub(org);
    const ref = await pending(org, { amount: 9500, currency: 'XAF' });
    expect((await settle(ref, 1000, 'XAF')).result).toBe('mismatch');
    expect((await q<any>(db, `select status, failure_reason from public.payments where provider_ref = $1`, [ref]))[0]).toEqual({ status: 'failed', failure_reason: 'amount_mismatch' });
    const ref2 = await pending(org, { amount: 9500, currency: 'XAF' });
    expect((await settle(ref2, 9500, 'XOF')).result).toBe('mismatch');
    expect(await sub(org)).toMatchObject({ plan: before.plan, status: 'trialing', provider: 'none' });
  });

  it('un paiement réussi active l’offre pour la période payée, avec un délai de grâce de 7 jours', async () => {
    const { org } = await newOrg('ok@x.test');
    const ref = await pending(org, { plan: 'standard', months: 1, amount: 9500, usd: 16.15, country: 'CM' });
    const r = await settle(ref);
    expect(r.result).toBe('ok');
    const s = await sub(org);
    expect(s).toMatchObject({ plan: 'standard', status: 'active', provider: 'pawapay', billing_interval: 'monthly', currency: 'XAF', country: 'CM', cancel_at_period_end: false });
    expect(Number(s.monthly_usd)).toBeCloseTo(16.15, 2);
    expect(days(s.current_period_end)).toBeGreaterThan(29);
    expect(days(s.current_period_end)).toBeLessThan(32);
    expect(days(s.grace_ends_at) - days(s.current_period_end)).toBeCloseTo(7, 1);
    const p = (await q<any>(db, `select status, period_start, period_end, completed_at from public.payments where provider_ref = $1`, [ref]))[0];
    expect(p.status).toBe('succeeded');
    expect(new Date(p.period_end).toISOString()).toBe(new Date(s.current_period_end).toISOString());
    expect(await effective(org)).toBe('standard');
  });

  it('est idempotent : relivré, un dépôt ne s’applique qu’une fois', async () => {
    const { org } = await newOrg('idem@x.test');
    const ref = await pending(org);
    await settle(ref);
    const end = (await sub(org)).current_period_end;
    expect((await settle(ref)).result).toBe('already');
    expect((await settle(ref)).result).toBe('already');
    expect((await sub(org)).current_period_end).toEqual(end);
  });

  it('renouveler la même offre ajoute la période à la fin de la période en cours', async () => {
    const { org } = await newOrg('renew@x.test');
    await settle(await pending(org));
    const first = new Date((await sub(org)).current_period_end).getTime();
    await settle(await pending(org));
    const second = new Date((await sub(org)).current_period_end).getTime();
    expect((second - first) / 86_400_000).toBeGreaterThan(28);
    expect((second - first) / 86_400_000).toBeLessThan(32);
  });

  it('12 mois prépayés : facturation annuelle, MRR = prix annuel / 12', async () => {
    const { org } = await newOrg('year@x.test');
    await settle(await pending(org, { plan: 'team', months: 12, amount: 187000, usd: 374.4 }), 187000);
    const s = await sub(org);
    expect(s).toMatchObject({ plan: 'team', billing_interval: 'yearly' });
    expect(Number(s.monthly_usd)).toBeCloseTo(31.2, 2);
    expect(days(s.current_period_end)).toBeGreaterThan(363);
  });

  it('passer à une offre supérieure convertit la valeur restante de l’ancienne, une seule fois', async () => {
    const { org } = await newOrg('upgrade@x.test');
    await settle(await pending(org, { plan: 'standard', amount: 9500, usd: 16.15 }));
    await settle(await pending(org, { plan: 'team', amount: 19500, usd: 33.15 }), 19500);
    const s = await sub(org);
    expect(s.plan).toBe('team');
    // 1 mois payé + ~16,15 / 33,15 ≈ 0,49 mois de crédit (la période de départ est maintenant : le crédit est quasi entier).
    expect(days(s.current_period_end)).toBeGreaterThan(30 + 13);
    expect(days(s.current_period_end)).toBeLessThan(30 + 17);
    expect((await q<any>(db, `select count(*)::int as n from public.payments where org_id = $1 and credited_at is not null`, [org]))[0].n).toBe(1);
    // Retour à Standard : le temps de Team restant se convertit à son tour, sans recompter le premier crédit.
    await settle(await pending(org, { plan: 'standard', amount: 9500, usd: 16.15 }));
    expect((await sub(org)).plan).toBe('standard');
    expect((await q<any>(db, `select count(*)::int as n from public.payments where org_id = $1 and credited_at is not null`, [org]))[0].n).toBe(2);
  });

  it('le crédit ne dépasse jamais une période de la nouvelle offre', async () => {
    const { org } = await newOrg('cap@x.test');
    await settle(await pending(org, { plan: 'agency', months: 12, amount: 379000, usd: 758.4 }), 379000);
    await settle(await pending(org, { plan: 'standard', amount: 9500, usd: 16.15 }));
    // Crédit énorme (≈ 758 $) pour 1 mois à 16 $ : plafonné à 1 période de plus.
    expect(days((await sub(org)).current_period_end)).toBeLessThan(62);
  });

  it('un abonnement Stripe actif n’est jamais écrasé : le paiement est gardé pour examen', async () => {
    const { org } = await newOrg('stripe-first@x.test');
    await setSub(org, `status = 'active', plan = 'team', provider = 'stripe', trial_ends_at = null, current_period_end = now() + interval '10 days'`);
    const ref = await pending(org, { plan: 'standard' });
    expect((await settle(ref)).result).toBe('review');
    expect(await sub(org)).toMatchObject({ plan: 'team', provider: 'stripe' });
    expect((await q<any>(db, `select status, failure_reason from public.payments where provider_ref = $1`, [ref]))[0]).toEqual({ status: 'succeeded', failure_reason: 'manual_review' });
  });

  it('un dépôt échoué ou expiré est marqué ainsi, jamais par-dessus un paiement réussi', async () => {
    const { org } = await newOrg('fail@x.test');
    const a = await pending(org);
    const b = await pending(org);
    const c = await pending(org);
    await settle(c);
    const fail = (ref: string, expired = false) =>
      asService(db, () => q<{ ok: boolean }>(db, `select public.billing_fail_payment('pawapay', $1, 'PAYMENT_NOT_APPROVED', $2) as ok`, [ref, expired])).then((r) => r[0]!.ok);
    expect(await fail(a)).toBe(true);
    expect(await fail(b, true)).toBe(true);
    expect(await fail(c)).toBe(false);
    const rows = await q<{ provider_ref: string; status: string }>(db, `select provider_ref, status from public.payments where org_id = $1`, [org]);
    expect(Object.fromEntries(rows.map((r) => [r.provider_ref, r.status]))).toEqual({ [a]: 'failed', [b]: 'expired', [c]: 'succeeded' });
    // Un dépôt échoué qui s'avère réussi chez le fournisseur peut encore être réglé.
    expect((await settle(a)).result).toBe('ok');
  });

  it('un même identifiant de dépôt ne peut exister qu’une fois', async () => {
    const { org } = await newOrg('dup@x.test');
    await pending(org, { ref: 'same' });
    await expect(pending(org, { ref: 'same' })).rejects.toThrow(/payments_provider_provider_ref_key/);
  });
});

describe('Stripe : état de l’abonnement et factures', () => {
  const sub0 = (over: Record<string, unknown> = {}) => ({
    plan: 'team', status: 'active', interval: 'monthly', current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(), cancel_at_period_end: false,
    customer: `cus_${++seq}`, subscription: `sub_${seq}`, currency: 'USD', country: 'FR', monthly_usd: 39, ...over,
  });
  const apply = (event: string, org: string, s: unknown, p: unknown = null, type = 'customer.subscription.updated') =>
    asService(db, () => q<{ r: string }>(db, `select public.billing_apply_stripe($1, $2, $3, $4::jsonb, $5::jsonb) as r`, [event, type, org, s ? JSON.stringify(s) : null, p ? JSON.stringify(p) : null])).then((r) => r[0]!.r);

  it('recopie l’abonnement Stripe et enregistre la facture payée', async () => {
    const { org, user } = await newOrg('stripe@x.test');
    const s = sub0();
    const inv = { invoice: 'in_1', plan: 'team', interval: 'monthly', amount: 39, currency: 'USD', usd_amount: 39, country: 'FR', period_start: new Date().toISOString(), period_end: s.current_period_end, user_id: user };
    expect(await apply('evt_1', org, s, inv, 'invoice.paid')).toBe('ok');
    expect(await sub(org)).toMatchObject({ plan: 'team', status: 'active', provider: 'stripe', stripe_customer_id: s.customer, stripe_subscription_id: s.subscription, currency: 'USD', country: 'FR' });
    expect(Number((await sub(org)).monthly_usd)).toBe(39);
    expect((await q<any>(db, `select provider, provider_ref, status, months, amount::float as amount, user_id from public.payments where org_id = $1`, [org]))[0])
      .toEqual({ provider: 'stripe', provider_ref: 'in_1', status: 'succeeded', months: 1, amount: 39, user_id: user });
    expect(await effective(org)).toBe('team');
  });

  it('est idempotent par événement et par facture', async () => {
    const { org } = await newOrg('stripe-idem@x.test');
    const inv = { invoice: 'in_2', plan: 'team', interval: 'yearly', amount: 374, currency: 'USD', usd_amount: 374, period_start: new Date().toISOString(), period_end: new Date(Date.now() + 365 * 86_400_000).toISOString() };
    expect(await apply('evt_2', org, sub0({ interval: 'yearly' }), inv, 'invoice.paid')).toBe('ok');
    expect(await apply('evt_2', org, sub0({ plan: 'agency' }), inv, 'invoice.paid')).toBe('duplicate');
    expect((await sub(org)).plan).toBe('team');
    // Autre événement, même facture : la facture n'est pas comptée deux fois.
    expect(await apply('evt_3', org, sub0({ interval: 'yearly' }), inv, 'invoice.paid')).toBe('ok');
    expect((await q<any>(db, `select count(*)::int as n from public.payments where org_id = $1`, [org]))[0].n).toBe(1);
    expect((await q<any>(db, `select months from public.payments where org_id = $1`, [org]))[0].months).toBe(12);
  });

  it('un événement qui échoue ne laisse aucune trace : sa relivraison est traitée', async () => {
    const { org } = await newOrg('stripe-rollback@x.test');
    await expect(apply('evt_4', org, sub0({ plan: 'gratuit' }))).rejects.toThrow(/abonnement invalide/);
    expect((await q<any>(db, `select count(*)::int as n from public.billing_events where event_id = 'evt_4'`))[0].n).toBe(0);
    expect(await apply('evt_4', org, sub0())).toBe('ok');
  });

  it('un défaut de paiement garde l’offre pendant 7 jours, une résiliation la retire', async () => {
    const { org } = await newOrg('stripe-late@x.test');
    await apply('evt_5', org, sub0());
    await apply('evt_6', org, sub0({ status: 'past_due', current_period_end: new Date(Date.now() - 86_400_000).toISOString() }));
    expect(await sub(org)).toMatchObject({ status: 'past_due' });
    expect(days((await sub(org)).grace_ends_at)).toBeGreaterThan(6);
    expect(await effective(org)).toBe('team');
    await apply('evt_7', org, sub0({ status: 'canceled', current_period_end: new Date(Date.now() - 86_400_000).toISOString() }));
    const s = await sub(org);
    expect(s.status).toBe('canceled');
    expect(s.canceled_at).not.toBeNull();
    expect(await effective(org)).toBe('free');
  });

  it('annulation en fin de période : l’offre reste jusqu’à la fin', async () => {
    const { org } = await newOrg('stripe-cancel@x.test');
    await apply('evt_8', org, sub0({ cancel_at_period_end: true }));
    expect(await sub(org)).toMatchObject({ cancel_at_period_end: true, status: 'active' });
    expect(await effective(org)).toBe('team');
  });

  it('une organisation inconnue est signalée, sans rien écrire', async () => {
    expect(await apply('evt_9', '00000000-0000-4000-8000-000000000000', sub0())).toBe('unknown_org');
  });
});

describe('fin de période', () => {
  it('aligne les statuts : mobile money en retard (grâce), terminé, abonnement offert échu ; Stripe intact', async () => {
    const mk = async (email: string, set: string) => {
      const { org } = await newOrg(email);
      await setSub(org, `plan = 'team', trial_ends_at = null, ${set}`);
      return org;
    };
    const late = await mk('late@x.test', `provider = 'pawapay', status = 'active', current_period_end = now() - interval '1 day', grace_ends_at = now() + interval '6 days'`);
    const ended = await mk('ended@x.test', `provider = 'pawapay', status = 'active', current_period_end = now() - interval '9 days', grace_ends_at = now() - interval '2 days'`);
    const gift = await mk('giftend@x.test', `provider = 'gift', status = 'active', current_period_end = now() - interval '1 day', grace_ends_at = null`);
    const stripe = await mk('stripe-end@x.test', `provider = 'stripe', status = 'active', current_period_end = now() - interval '1 day', grace_ends_at = now() + interval '2 days'`);
    const live = await mk('live@x.test', `provider = 'pawapay', status = 'active', current_period_end = now() + interval '5 days', grace_ends_at = now() + interval '12 days'`);
    const r = (await asService(db, () => q<{ r: any }>(db, `select public.billing_expire_lapsed() as r`)))[0]!.r;
    expect(r.past_due).toBe(1);
    expect(r.ended).toBeGreaterThanOrEqual(2);
    expect((await sub(late)).status).toBe('past_due');
    expect(await effective(late)).toBe('team'); // encore en grâce
    expect((await sub(ended)).status).toBe('canceled');
    expect(await effective(ended)).toBe('free');
    expect((await sub(gift)).status).toBe('canceled');
    expect((await sub(stripe)).status).toBe('active');
    expect((await sub(live)).status).toBe('active');
  });
});

describe('abonnement offert', () => {
  const grant = (user: string, org: string, plan = 'team', note: string | null = 'Partenaire', until = `now() + interval '90 days'`) =>
    asUser(db, user, () => q<{ r: any }>(db, `select public.admin_grant_subscription($1, $2, ${until}, $3) as r`, [org, plan, note]));

  it('seul le propriétaire de la plateforme offre un abonnement', async () => {
    await expect(grant(w.alice, w.orgA)).rejects.toThrow(/forbidden/);
    await expect(asUser(db, w.alice, () => q(db, `select public.admin_revoke_gift($1)`, [w.orgA]))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, w.alice, () => q(db, `select * from public.admin_payments()`))).rejects.toThrow(/forbidden/);
    await expect(asAnon(db, () => q(db, `select public.admin_grant_subscription($1, 'team', now() + interval '1 day', null)`, [w.orgA]))).rejects.toThrow(/permission denied/);
  });

  it('offre l’offre choisie jusqu’à la date donnée, sans rien compter comme revenu', async () => {
    const { org } = await newOrg('gift@x.test');
    await grant(owner, org, 'agency', 'Ambassadeur');
    const s = await sub(org);
    expect(s).toMatchObject({ plan: 'agency', status: 'active', provider: 'gift', gift_note: 'Ambassadeur', cancel_at_period_end: false });
    expect(Number(s.monthly_usd)).toBe(0);
    expect(s.gifted_by).toBe(owner);
    expect(days(s.current_period_end)).toBeGreaterThan(89);
    expect(await effective(org)).toBe('agency');
    const p = (await q<any>(db, `select provider, amount::float as amount, status, plan from public.payments where org_id = $1`, [org]))[0];
    expect(p).toEqual({ provider: 'gift', amount: 0, status: 'succeeded', plan: 'agency' });
  });

  it('remplace un essai, ou un autre cadeau, mais jamais un abonnement payé', async () => {
    const { org } = await newOrg('gift2@x.test');
    await grant(owner, org, 'team');
    await grant(owner, org, 'standard', 'Prolongation');
    expect(await sub(org)).toMatchObject({ plan: 'standard', provider: 'gift', gift_note: 'Prolongation' });
    await setSub(org, `provider = 'pawapay', status = 'active', current_period_end = now() + interval '10 days', grace_ends_at = now() + interval '17 days'`);
    await expect(grant(owner, org)).rejects.toThrow(/has paid subscription/);
    await setSub(org, `provider = 'stripe', status = 'past_due', current_period_end = now() - interval '1 day', grace_ends_at = now() + interval '3 days'`);
    await expect(grant(owner, org)).rejects.toThrow(/has paid subscription/);
    // Un abonnement payé terminé n'empêche plus le cadeau.
    await setSub(org, `provider = 'pawapay', status = 'canceled', grace_ends_at = now() - interval '1 day'`);
    await grant(owner, org, 'team');
    expect((await sub(org)).provider).toBe('gift');
  });

  it('refuse une offre, une date ou une organisation invalides', async () => {
    const { org } = await newOrg('gift3@x.test');
    await expect(grant(owner, org, 'free')).rejects.toThrow(/invalid plan/);
    await expect(grant(owner, org, 'team', null, `now() - interval '1 day'`)).rejects.toThrow(/invalid end date/);
    await expect(grant(owner, org, 'team', null, `now() + interval '6 years'`)).rejects.toThrow(/invalid end date/);
    await expect(grant(owner, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/organization not found/);
  });

  it('se retire sans toucher à un abonnement payé', async () => {
    const { org } = await newOrg('gift4@x.test');
    await grant(owner, org);
    expect((await asUser(db, owner, () => q<{ v: boolean }>(db, `select public.admin_revoke_gift($1) as v`, [org])))[0]!.v).toBe(true);
    expect(await sub(org)).toMatchObject({ status: 'canceled' });
    expect(await effective(org)).toBe('free');
    const { org: paid } = await newOrg('gift5@x.test');
    await setSub(paid, `provider = 'stripe', status = 'active', plan = 'team', trial_ends_at = null, current_period_end = now() + interval '9 days'`);
    expect((await asUser(db, owner, () => q<{ v: boolean }>(db, `select public.admin_revoke_gift($1) as v`, [paid])))[0]!.v).toBe(false);
    expect((await sub(paid)).status).toBe('active');
  });

  it('le tableau de bord compte les cadeaux à part et calcule le MRR sur les prix réellement payés', async () => {
    const o = (await asUser(db, owner, () => q<{ o: any }>(db, 'select public.admin_overview() as o')))[0]!.o;
    expect(o.gifts).toBeGreaterThanOrEqual(1);
    const gift = o.by_plan.filter((r: any) => r.provider === 'gift');
    expect(gift.length).toBeGreaterThan(0);
    expect(gift.every((r: any) => Number(r.mrr_usd) === 0)).toBe(true);
    const stripe = o.by_plan.find((r: any) => r.provider === 'stripe' && r.plan === 'team' && r.phase === 'paying');
    expect(stripe).toBeTruthy();
    expect(Number(stripe.mrr_usd)).toBeGreaterThan(0);
  });

  it('la fiche utilisateur et la liste des paiements exposent le fournisseur et le cadeau', async () => {
    const { user, org } = await newOrg('gift6@x.test');
    await grant(owner, org, 'team', 'Presse');
    const d = (await asUser(db, owner, () => q<{ d: any }>(db, `select public.admin_user_detail($1) as d`, [user])))[0]!.d;
    expect(d.orgs[0].subscription).toMatchObject({ provider: 'gift', gift_note: 'Presse', effective_plan: 'team' });
    const rows = await asUser(db, owner, () => q<any>(db, `select * from public.admin_payments(10, 0)`));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].total_count).toBeGreaterThanOrEqual(rows.length);
  });
});

describe('quotas d’IA', () => {
  let org: string;
  let user: string;
  beforeAll(async () => {
    ({ org, user } = await newOrg('ia@x.test'));
    await setSub(org, `trial_ends_at = now() - interval '1 day'`); // Gratuit : 30 textes, 5 images, 0 vidéo par mois
    await enable(true);
  });

  const text = () => asUser(db, user, () => q<{ ok: boolean }>(db, `select public.ai_text_reserve($1, 'assistant') as ok`, [org])).then((r) => r[0]!.ok);
  const media = (kind: string, daily = 100) =>
    asUser(db, user, () => q<{ r: string }>(db, `select public.ai_media_reserve($1, $2, $3) as r`, [org, kind, daily])).then((r) => r[0]!.r);

  it('l’IA texte s’arrête à la limite mensuelle de l’offre', async () => {
    await q(db, `insert into public.ai_text_usage (org_id, user_id, feature) select $1, $2, 'agent' from generate_series(1, 29)`, [org, user]);
    expect(await text()).toBe(true);
    expect(await text()).toBe(false);
  });

  it('seul le mois en cours compte', async () => {
    await q(db, `insert into public.ai_text_usage (org_id, user_id, feature, created_at) select $1, $2, 'agent', date_trunc('month', now()) - interval '1 day' from generate_series(1, 50)`, [org, user]);
    expect(await text()).toBe(false); // le mois en cours est plein
    await setSub(org, `status = 'active', plan = 'team', trial_ends_at = null, current_period_end = now() + interval '9 days'`);
    expect(await text()).toBe(true); // Team : 1 500
    await setSub(org, `status = 'trialing', plan = 'standard', trial_ends_at = now() - interval '1 day', current_period_end = null`);
  });

  it('images et vidéos : limite mensuelle de l’offre, puis plafond journalier', async () => {
    expect(await media('video')).toBe('monthly'); // Gratuit : aucune vidéo
    for (let i = 0; i < 5; i++) expect(await media('image')).toBe('ok');
    expect(await media('image')).toBe('monthly');
    await setSub(org, `status = 'active', plan = 'standard', trial_ends_at = null, current_period_end = now() + interval '9 days'`);
    expect(await media('image', 5)).toBe('daily'); // 5 déjà faites aujourd'hui
    expect(await media('image', 50)).toBe('ok');
    await setSub(org, `status = 'trialing', plan = 'standard', trial_ends_at = now() - interval '1 day', current_period_end = null`);
  });

  it('les images du mois précédent ne comptent pas', async () => {
    const other = await newOrg('ia2@x.test');
    await setSub(other.org, `trial_ends_at = now() - interval '1 day'`);
    await q(db, `insert into public.ai_generations (org_id, user_id, kind, created_at) select $1, $2, 'image', date_trunc('month', now()) - interval '2 days' from generate_series(1, 10)`, [other.org, other.user]);
    expect((await asUser(db, other.user, () => q<{ r: string }>(db, `select public.ai_media_reserve($1, 'image', 100) as r`, [other.org])))[0]!.r).toBe('ok');
  });

  it('un lecteur ou un étranger n’obtiennent rien', async () => {
    expect((await asUser(db, w.dave, () => q<{ r: string }>(db, `select public.ai_media_reserve($1, 'image', 10) as r`, [w.orgA])))[0]!.r).toBe('denied');
    expect((await asUser(db, w.bob, () => q<{ ok: boolean }>(db, `select public.ai_text_reserve($1, 'agent') as ok`, [w.orgA])))[0]!.ok).toBe(false);
    await expect(asUser(db, user, () => q(db, `select public.ai_text_reserve($1, 'autre')`, [org]))).rejects.toThrow(/invalide/);
    await expect(asUser(db, user, () => q(db, `select public.ai_media_reserve($1, 'audio', 1)`, [org]))).rejects.toThrow(/invalide/);
  });

  it('le journal d’IA texte est en ajout seul', async () => {
    await expect(asUser(db, user, () => q(db, `delete from public.ai_text_usage`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, user, () => q(db, `update public.ai_text_usage set feature = 'agent'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, user, () => q(db, `insert into public.ai_text_usage (org_id, user_id, feature) values ($1, $2, 'agent')`, [org, w.alice]))).rejects.toThrow(/row-level security/);
  });

  it('sans facturation, l’IA texte n’est pas limitée mais reste journalisée', async () => {
    await enable(false);
    const before = (await q<{ n: number }>(db, `select count(*)::int as n from public.ai_text_usage where org_id = $1`, [org]))[0]!.n;
    expect(await text()).toBe(true);
    expect(await media('video')).toBe('ok');
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.ai_text_usage where org_id = $1`, [org]))[0]!.n).toBe(before + 1);
  });
});

describe('stockage et usage', () => {
  let org: string;
  let user: string;
  const file = (mb: number) =>
    asUser(db, user, () => q(db, `insert into public.media (org_id, path, mime_type, size_bytes, created_by) values ($1, $2, 'image/png', $3, $4)`,
      [org, `${org}/${Math.random().toString(16).slice(2)}.png`, mb * 1048576, user]));

  beforeAll(async () => {
    ({ org, user } = await newOrg('stock@x.test'));
    await setSub(org, `trial_ends_at = now() - interval '1 day'`); // Gratuit : 500 Mo
    await enable(true);
  });

  it('refuse un fichier qui ferait dépasser le stockage de l’offre', async () => {
    await file(400);
    await expect(file(200)).rejects.toThrow(/storage_limit/);
    await file(100);
  });

  it('sans facturation, aucun plafond de stockage', async () => {
    await enable(false);
    await file(900);
    await enable(true);
  });

  it('org_usage donne l’offre, l’usage et les limites à un membre, à lui seul', async () => {
    const u = (await asUser(db, user, () => q<{ u: any }>(db, `select public.org_usage($1) as u`, [org])))[0]!.u;
    expect(u).toMatchObject({ enabled: true, plan: 'free', usage: { channels: 0, members: 1 }, limits: { channels: 3, members: 1, storage_mb: 500 } });
    expect(Number(u.usage.storage_mb)).toBeGreaterThan(1000);
    await expect(asUser(db, w.bob, () => q(db, `select public.org_usage($1)`, [org]))).rejects.toThrow(/forbidden/);
    await enable(false);
  });
});
