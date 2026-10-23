import { describe, expect, it } from 'vitest';
import { demoOrganizations, demoOverview, demoUserDetail, demoUsers } from './demo';
import { PAGE_SIZE, daysUntil, isUserId, listHref, pageCount, parseListQuery, parseOrgRow, parseOverview, parsePage, parsePhase, parseUserDetail, parseUserRow, percent, revenue, totalOf } from './logic';
import { PHASES, type PlanCount } from './types';

describe('parseOverview', () => {
  it('convertit la réponse de la base (snake_case) et met zéro pour ce qui manque', () => {
    const o = parseOverview({ users: { total: '12', new_7d: 3 }, phases: { trialing: 4 }, channels: { by_provider: { instagram: 2 } } });
    expect(o.users).toEqual({ total: 12, new7d: 3, new30d: 0, active7d: 0, unconfirmed: 0 });
    expect(o.phases).toEqual({ trialing: 4, paying: 0, trial_expired: 0, past_due: 0, canceled: 0, none: 0 });
    expect(o.channels.byProvider).toEqual({ instagram: 2 });
    expect(o.signups).toEqual([]);
  });

  it('ne casse pas sur une réponse vide ou invalide', () => {
    for (const raw of [null, undefined, 'x', 3, []]) expect(parseOverview(raw).users.total).toBe(0);
  });

  it('une phase inconnue est rangée dans « sans abonnement »', () => {
    expect(parseOverview({ by_plan: [{ plan: 'pro', interval: 'yearly', phase: 'bizarre', count: 2 }] }).byPlan).toEqual([{ plan: 'pro', interval: 'yearly', phase: 'none', count: 2 }]);
  });
});

describe('lignes', () => {
  it('parseUserRow lit une ligne de admin_users', () => {
    const u = parseUserRow({
      user_id: 'u1', email: 'a@b.fr', display_name: 'Ana', created_at: '2026-10-01T10:00:00Z', last_sign_in_at: null, email_confirmed: true,
      org_id: 'o1', org_name: 'Atelier', role: 'admin', orgs_count: 2, plan: 'pro', status: 'trialing', billing_interval: 'monthly', phase: 'trialing',
      trial_ends_at: '2026-10-15T10:00:00Z', current_period_end: null, cancel_at_period_end: false, channels_count: 3, posts_count: 9, total_count: 41,
    });
    expect(u).toMatchObject({ userId: 'u1', name: 'Ana', role: 'admin', phase: 'trialing', interval: 'monthly', channelsCount: 3, lastSignInAt: null });
  });

  it('un utilisateur sans organisation a des valeurs vides, pas des erreurs', () => {
    const u = parseUserRow({ user_id: 'u2', email: 'x@y.fr', phase: 'none', orgs_count: 0 });
    expect(u).toMatchObject({ orgId: null, orgName: null, role: null, plan: null, interval: null, phase: 'none', emailConfirmed: false });
  });

  it('parseOrgRow lit une ligne de admin_organizations', () => {
    expect(parseOrgRow({ org_id: 'o1', org_name: 'Atelier', owner_email: 'a@b.fr', members_count: 3, phase: 'paying', plan: 'team', billing_interval: 'yearly', cancel_at_period_end: true }))
      .toMatchObject({ orgId: 'o1', name: 'Atelier', ownerEmail: 'a@b.fr', membersCount: 3, phase: 'paying', interval: 'yearly', cancelAtPeriodEnd: true });
  });

  it('totalOf lit le total porté par la première ligne', () => {
    expect(totalOf([{ total_count: '57' }, { total_count: '57' }])).toBe(57);
    expect(totalOf([])).toBe(0);
  });
});

describe('revenue', () => {
  const rows: PlanCount[] = [
    { plan: 'pro', interval: 'monthly', phase: 'paying', count: 2 }, // 2 × 49
    { plan: 'team', interval: 'yearly', phase: 'paying', count: 1 }, // 95 / mois (119 − 20 %)
    { plan: 'starter', interval: 'monthly', phase: 'past_due', count: 1 }, // pas compté tant que le paiement n'est pas régularisé
    { plan: 'pro', interval: 'monthly', phase: 'trialing', count: 3 }, // potentiel seulement
    { plan: 'pro', interval: 'monthly', phase: 'canceled', count: 5 },
    { plan: 'pro', interval: 'monthly', phase: 'trial_expired', count: 4 },
  ];

  it('additionne les abonnements payants au tarif publié, selon le rythme de facturation', () => {
    const r = revenue(rows);
    expect(r.mrr).toBe(2 * 49 + 95);
    expect(r.arr).toBe(r.mrr * 12);
    expect(r.payingOrgs).toBe(3);
  });

  it('ne compte pas les essais dans le revenu, seulement dans le potentiel', () => {
    expect(revenue(rows).trialPotential).toBe(3 * 49);
    expect(revenue(rows.filter((r) => r.phase === 'trialing')).mrr).toBe(0);
  });

  it('une offre inconnue vaut zéro au lieu de fausser le total', () => {
    expect(revenue([{ plan: 'ancienne', interval: 'monthly', phase: 'paying', count: 2 }]).mrr).toBe(0);
  });
});

describe('utilitaires', () => {
  it('percent arrondit et ne divise pas par zéro', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 0)).toBe(0);
  });

  it('daysUntil arrondit au jour supérieur : un essai qui finit dans 2 h compte pour 1 jour', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    expect(daysUntil('2026-10-23T14:00:00Z', now)).toBe(1);
    expect(daysUntil('2026-10-26T12:00:00Z', now)).toBe(3);
    expect(daysUntil('2026-10-22T12:00:00Z', now)).toBe(-1);
  });
});

describe('paramètres d’URL', () => {
  it('parsePhase n’accepte que les phases connues', () => {
    for (const p of PHASES) expect(parsePhase(p)).toBe(p);
    expect(parsePhase('DROP TABLE')).toBeNull();
    expect(parsePhase(undefined)).toBeNull();
    expect(parsePhase(['paying', 'none'])).toBe('paying');
  });

  it('parsePage rejette ce qui n’est pas une page valide', () => {
    expect(parsePage('3')).toBe(3);
    for (const v of ['0', '-2', '1.5', 'abc', '', undefined, '99999999']) expect(parsePage(v)).toBe(1);
  });

  it('parseListQuery nettoie la recherche', () => {
    expect(parseListQuery({ q: '  léa  ', phase: 'trialing', page: '2' })).toEqual({ search: 'léa', phase: 'trialing', page: 2 });
    expect(parseListQuery({ q: 'x'.repeat(500) }).search).toHaveLength(100);
    expect(parseListQuery({})).toEqual({ search: '', phase: null, page: 1 });
  });

  it('listHref omet les valeurs vides et encode la recherche', () => {
    expect(listHref('/admin/utilisateurs', {})).toBe('/admin/utilisateurs');
    expect(listHref('/admin/utilisateurs', { search: 'a&b c', phase: 'paying', page: 3 })).toBe('/admin/utilisateurs?q=a%26b+c&phase=paying&page=3');
    expect(listHref('/admin/utilisateurs', { page: 1 })).toBe('/admin/utilisateurs');
  });

  it('pageCount compte au moins une page', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
  });
});

describe('données de démonstration', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const all = { search: '', phase: null, page: 1 } as const;

  it('le tableau de bord et les listes racontent la même histoire', () => {
    const o = demoOverview(now);
    expect(o.users.total).toBe(demoUsers({ ...all, page: 1 }, now).total);
    for (const p of PHASES) expect(demoUsers({ ...all, phase: p }, now).total, p).toBe(o.phases[p]);
    expect(o.signups).toHaveLength(30);
    expect(o.signups.reduce((n, d) => n + d.count, 0)).toBe(o.users.new30d);
  });

  it('filtre et pagine comme la base', () => {
    const first = demoUsers(all, now);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    const second = demoUsers({ ...all, page: 2 }, now);
    expect(second.rows.length).toBe(first.total - PAGE_SIZE);
    expect(demoUsers({ ...all, search: 'zzzz-introuvable' }, now).rows).toEqual([]);
    expect(demoOrganizations({ ...all, phase: 'paying' }, now).rows.every((o) => o.phase === 'paying')).toBe(true);
  });

  it('un essai en cours a une date de fin dans le futur, un essai terminé dans le passé', () => {
    for (const u of demoUsers({ ...all, phase: 'trialing' }, now).rows) expect(new Date(u.trialEndsAt!).getTime()).toBeGreaterThan(now.getTime());
    for (const u of demoUsers({ ...all, phase: 'trial_expired' }, now).rows) expect(new Date(u.trialEndsAt!).getTime()).toBeLessThan(now.getTime());
  });
});

describe('fiche d’un utilisateur', () => {
  const raw = {
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.fr', display_name: 'Ana', created_at: '2026-10-01T10:00:00Z', last_sign_in_at: null, email_confirmed_at: '2026-10-01T10:05:00Z', provider: 'google' },
    orgs: [{
      org_id: 'o1', name: 'Atelier', created_at: '2026-10-01T10:00:00Z', role: 'admin', members_count: 3,
      subscription: { plan: 'pro', status: 'active', billing_interval: 'yearly', phase: 'paying', current_period_end: '2027-01-01T00:00:00Z', cancel_at_period_end: true, stripe_customer_id: 'cus_1', created_at: '2026-10-02T00:00:00Z' },
      channels: [{ id: 'c1', provider: 'youtube', name: 'Chaîne', username: '@x', status: 'refresh_needed', created_at: '2026-10-03T00:00:00Z', token_expires_at: null }],
      posts: { by_state: { published: '4', draft: 1 }, last_published_at: '2026-10-20T00:00:00Z', last_created_at: null },
    }],
  };

  it('lit le compte, l’organisation, l’abonnement, les canaux et les chiffres de publication', () => {
    const d = parseUserDetail(raw)!;
    expect(d).toMatchObject({ id: raw.user.id, name: 'Ana', provider: 'google', lastSignInAt: null });
    expect(d.orgs[0]).toMatchObject({ name: 'Atelier', role: 'admin', membersCount: 3 });
    expect(d.orgs[0]!.subscription).toMatchObject({ plan: 'pro', interval: 'yearly', phase: 'paying', cancelAtPeriodEnd: true, stripeCustomerId: 'cus_1', stripeSubscriptionId: null });
    expect(d.orgs[0]!.channels[0]).toMatchObject({ provider: 'youtube', status: 'refresh_needed', tokenExpiresAt: null });
    expect(d.orgs[0]!.posts.byState).toEqual({ published: 4, draft: 1 });
  });

  it('renvoie null pour un utilisateur inconnu (la base répond null) ou une réponse invalide', () => {
    for (const bad of [null, undefined, {}, 'x', { user: {} }]) expect(parseUserDetail(bad)).toBeNull();
  });

  it('une organisation sans abonnement a subscription à null ; un état de canal inconnu devient « actif »', () => {
    const d = parseUserDetail({ ...raw, orgs: [{ ...raw.orgs[0], subscription: null, channels: [{ id: 'c', provider: 'x', name: 'n', status: 'bizarre' }] }] })!;
    expect(d.orgs[0]!.subscription).toBeNull();
    expect(d.orgs[0]!.channels[0]!.status).toBe('active');
  });

  it('un utilisateur sans organisation a une liste vide', () => {
    expect(parseUserDetail({ user: raw.user, orgs: [] })!.orgs).toEqual([]);
  });

  it('isUserId refuse tout ce qui n’a pas la forme d’un UUID', () => {
    expect(isUserId('11111111-1111-4111-8111-111111111111')).toBe(true);
    for (const v of ['', 'abc', '1; drop table', '11111111-1111-4111-8111-11111111111', '../../etc']) expect(isUserId(v)).toBe(false);
  });

  it('la démo donne une fiche cohérente avec la ligne de la liste', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    const row = demoUsers({ search: '', phase: 'paying', page: 1 }, now).rows[0]!;
    const d = demoUserDetail(row.userId, now)!;
    expect(d.email).toBe(row.email);
    expect(d.orgs[0]!.channels).toHaveLength(row.channelsCount);
    expect(Object.values(d.orgs[0]!.posts.byState).reduce((a, b) => a + b, 0)).toBe(row.postsCount);
    expect(d.orgs[0]!.subscription).toMatchObject({ plan: row.plan, phase: 'paying' });
    expect(demoUserDetail('00000000-0000-4000-9000-ffffffffffff', now)).toBeNull();
  });
});
