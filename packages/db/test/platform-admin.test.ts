import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createDb, createUser, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;
let owner: string; // propriétaire de la plateforme
let late: string; // utilisateur dont l'essai est terminé
let payer: string; // utilisateur abonné
let lateOrg: string;
let payerOrg: string;

const admin = <T>(fn: () => Promise<T>) => asUser(db, owner, fn);
const overview = () => admin(async () => (await q<{ o: any }>(db, 'select public.admin_overview() as o'))[0]!.o);
const users = (search: string | null = null, phase: string | null = null, limit = 25, offset = 0) =>
  admin(() => q<any>(db, 'select * from public.admin_users($1, $2, $3, $4)', [search, phase, limit, offset]));

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
  owner = await createUser(db, 'owner@postbiz.test');
  await asService(db, () => q(db, 'insert into public.platform_admins (user_id) values ($1)', [owner]));

  late = await createUser(db, 'late@c.test');
  payer = await createUser(db, 'payer@d.test');
  lateOrg = await asUser(db, late, async () => (await q<{ id: string }>(db, `select public.create_organization('Essai fini') as id`))[0]!.id);
  payerOrg = await asUser(db, payer, async () => (await q<{ id: string }>(db, `select public.create_organization('Cliente payante') as id`))[0]!.id);
  await q(db, `update public.subscriptions set trial_ends_at = now() - interval '2 days' where org_id = $1`, [lateOrg]);
  await q(db, `update public.subscriptions set status = 'active', plan = 'team', billing_interval = 'yearly', trial_ends_at = null, current_period_end = now() + interval '200 days' where org_id = $1`, [payerOrg]);
});

describe('essai gratuit', () => {
  it('une nouvelle organisation démarre un essai de 14 jours sur l’offre Standard', async () => {
    const [s] = await q<{ plan: string; status: string; days: number }>(db,
      `select plan, status::text, round(extract(epoch from trial_ends_at - now()) / 86400)::int as days from public.subscriptions where org_id = $1`, [w.orgA]);
    expect(s).toEqual({ plan: 'standard', status: 'trialing', days: 14 });
  });

  it('un essai doit avoir une date de fin', async () => {
    await expect(q(db, `update public.subscriptions set trial_ends_at = null where org_id = $1`, [w.orgA])).rejects.toThrow(/subscriptions_trial_has_end/);
  });
});

describe('droits sur les abonnements', () => {
  it('un membre voit l’abonnement de son organisation, pas celui d’une autre', async () => {
    const rows = await asUser(db, w.carol, () => q<{ org_id: string }>(db, 'select org_id from public.subscriptions'));
    expect(rows.map((r) => r.org_id)).toEqual([w.orgA]);
  });

  it('un client ne peut ni s’accorder un abonnement ni modifier le sien', async () => {
    await expect(asUser(db, w.alice, () => q(db, `update public.subscriptions set status = 'active' where org_id = $1`, [w.orgA]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `delete from public.subscriptions where org_id = $1`, [w.orgA]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `insert into public.subscriptions (org_id) values ($1)`, [w.orgB]))).rejects.toThrow(/permission denied/);
  });

  it('personne d’autre que le service ne lit la liste des administrateurs de la plateforme', async () => {
    await expect(asUser(db, owner, () => q(db, 'select * from public.platform_admins'))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `insert into public.platform_admins (user_id) values ($1)`, [w.alice]))).rejects.toThrow(/permission denied/);
  });
});

describe('accès à l’espace propriétaire', () => {
  it('is_platform_admin est vrai pour le propriétaire seulement', async () => {
    expect((await asUser(db, owner, () => q<{ v: boolean }>(db, 'select public.is_platform_admin() as v')))[0]!.v).toBe(true);
    expect((await asUser(db, w.alice, () => q<{ v: boolean }>(db, 'select public.is_platform_admin() as v')))[0]!.v).toBe(false);
  });

  it('un utilisateur ordinaire est refusé par chaque fonction, même en appelant l’API directement', async () => {
    for (const sql of ['select public.admin_overview()', 'select * from public.admin_users()', 'select * from public.admin_organizations()']) {
      await expect(asUser(db, w.alice, () => q(db, sql)), sql).rejects.toThrow(/forbidden/);
    }
  });

  it('un visiteur anonyme n’a pas le droit d’exécuter ces fonctions', async () => {
    await expect(asAnon(db, () => q(db, 'select public.admin_overview()'))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => q(db, 'select * from public.admin_users()'))).rejects.toThrow(/permission denied/);
  });
});

describe('admin_overview', () => {
  it('compte les utilisateurs et les organisations de toute la plateforme', async () => {
    const o = await overview();
    expect(o.users.total).toBe(7); // alice, carol, dave, bob, owner, late, payer
    expect(o.users.new_7d).toBe(7);
    expect(o.orgs.total).toBe(4); // A, B, essai fini, cliente payante
    expect(o.users.unconfirmed).toBe(7);
  });

  it('répartit les organisations par phase : essai en cours, essai terminé, payant', async () => {
    const o = await overview();
    expect(o.phases).toEqual({ trialing: 2, trial_expired: 1, paying: 1 });
  });

  it('compte les organisations sans abonnement (bêta) à part, sans leur inventer d’essai', async () => {
    await asService(db, () => q(db, `insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000000aa', 'Ancienne')`));
    await q(db, `delete from public.subscriptions where org_id = '00000000-0000-0000-0000-0000000000aa'`);
    const o = await overview();
    expect(o.phases.none).toBe(1);
    await q(db, `delete from public.organizations where id = '00000000-0000-0000-0000-0000000000aa'`);
  });

  it('annonce les essais qui se terminent dans 3 jours', async () => {
    await q(db, `update public.subscriptions set trial_ends_at = now() + interval '2 days' where org_id = $1`, [w.orgB]);
    expect((await overview()).trials_ending_3d).toBe(1);
    await q(db, `update public.subscriptions set trial_ends_at = now() + interval '14 days' where org_id = $1`, [w.orgB]);
  });

  it('détaille les organisations par offre et rythme de facturation (le prix est calculé par l’application)', async () => {
    const o = await overview();
    expect(o.by_plan).toEqual(expect.arrayContaining([{ plan: 'team', interval: 'yearly', phase: 'paying', provider: 'none', count: 1, mrr_usd: 0 }, { plan: 'standard', interval: 'monthly', phase: 'trialing', provider: 'none', count: 2, mrr_usd: 0 }]));
  });

  it('compte les canaux par réseau et ceux à reconnecter', async () => {
    await q(db, `update public.integrations set status = 'refresh_needed' where id = $1`, [w.intB]);
    const o = await overview();
    expect(o.channels).toMatchObject({ total: 2, needs_reconnect: 1, by_provider: { instagram: 2 } });
    expect(o.orgs.with_channel).toBe(2);
  });

  it('renvoie les inscriptions des 30 derniers jours, jour par jour', async () => {
    const o = await overview();
    expect(o.signups).toHaveLength(30);
    expect(o.signups.at(-1).count).toBe(7);
    expect(o.signups.slice(0, 29).every((d: { count: number }) => d.count === 0)).toBe(true);
  });
});

describe('admin_users', () => {
  it('liste tous les utilisateurs avec leur organisation et leur abonnement', async () => {
    const rows = await users();
    expect(rows).toHaveLength(7);
    expect(rows[0].total_count).toBe(7);
    const p = rows.find((r: any) => r.email === 'payer@d.test');
    expect(p).toMatchObject({ org_name: 'Cliente payante', role: 'admin', plan: 'team', billing_interval: 'yearly', phase: 'paying', orgs_count: 1 });
    expect(rows.find((r: any) => r.email === 'owner@postbiz.test')).toMatchObject({ org_id: null, phase: 'none', orgs_count: 0 });
  });

  it('filtre par phase : les essais en cours, les essais terminés, les payants', async () => {
    expect((await users(null, 'trialing')).map((r: any) => r.email).sort()).toEqual(['alice@a.test', 'bob@b.test', 'carol@a.test', 'dave@a.test']);
    expect((await users(null, 'trial_expired')).map((r: any) => r.email)).toEqual(['late@c.test']);
    expect((await users(null, 'paying')).map((r: any) => r.email)).toEqual(['payer@d.test']);
  });

  it('cherche par e-mail ou par nom d’organisation, sans tenir compte de la casse', async () => {
    expect((await users('PAYER')).map((r: any) => r.email)).toEqual(['payer@d.test']);
    expect((await users('essai fini')).map((r: any) => r.email)).toEqual(['late@c.test']);
  });

  it('prend % et _ pour des caractères ordinaires, pas pour des jokers', async () => {
    expect(await users('%')).toHaveLength(0);
    expect(await users('_')).toHaveLength(0);
    expect(await users('a_a')).toHaveLength(0); // « a_a » ne doit pas trouver « alice@a.test »
  });

  it('pagine, et total_count reste le nombre de résultats avant la page', async () => {
    const page1 = await users(null, null, 3, 0);
    const page2 = await users(null, null, 3, 3);
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0].total_count).toBe(7);
    expect(new Set([...page1, ...page2].map((r: any) => r.user_id)).size).toBe(6);
    expect(await users(null, null, 3, 6)).toHaveLength(1);
  });

  it('borne la taille de page', async () => {
    expect((await users(null, null, 100000)).length).toBe(7);
    expect((await users(null, null, -5)).length).toBe(1);
  });

  it('indique la dernière connexion et si l’e-mail est confirmé', async () => {
    await q(db, `update auth.users set email_confirmed_at = now(), last_sign_in_at = now() where id = $1`, [payer]);
    const p = (await users('payer'))[0];
    expect(p.email_confirmed).toBe(true);
    expect(p.last_sign_in_at).not.toBeNull();
    expect((await overview()).users).toMatchObject({ active_7d: 1, unconfirmed: 6 });
  });
});

describe('admin_organizations', () => {
  it('liste les organisations avec leur propriétaire, leurs membres et leur abonnement', async () => {
    const rows = await admin(() => q<any>(db, 'select * from public.admin_organizations()'));
    expect(rows).toHaveLength(4);
    expect(rows.find((r: any) => r.org_name === 'Org A')).toMatchObject({ owner_email: 'alice@a.test', members_count: 3, channels_count: 1, phase: 'trialing', plan: 'standard' });
    expect(rows.find((r: any) => r.org_name === 'Cliente payante')).toMatchObject({ owner_email: 'payer@d.test', phase: 'paying', plan: 'team' });
  });

  it('filtre par phase et par recherche', async () => {
    const expired = await admin(() => q<any>(db, `select * from public.admin_organizations(null, 'trial_expired')`));
    expect(expired.map((r: any) => r.org_name)).toEqual(['Essai fini']);
    const found = await admin(() => q<any>(db, `select * from public.admin_organizations('alice')`));
    expect(found.map((r: any) => r.org_name)).toEqual(['Org A']);
  });
});

describe('admin_user_detail', () => {
  const detail = (id: string) => admin(async () => (await q<{ d: any }>(db, 'select public.admin_user_detail($1) as d', [id]))[0]!.d);
  let ytId: string;

  beforeAll(async () => {
    ytId = (await q<{ id: string }>(db,
      `insert into public.integrations (org_id, provider, internal_id, name, username) values ($1,'youtube','yt-1','Chaîne Payante','@payante') returning id`, [payerOrg]))[0]!.id;
    await q(db, `insert into public.integration_secrets (integration_id, access_token_enc) values ($1, 'ENC-JETON-SECRET')`, [ytId]);
    await q(db,
      `insert into public.posts (org_id, integration_id, content, state, publish_at, deleted_at) values
         ($1,$2,'TEXTE-PRIVE-1','published', now() - interval '3 days', null),
         ($1,$2,'TEXTE-PRIVE-2','published', now() - interval '1 day', null),
         ($1,$2,'TEXTE-PRIVE-3','draft', null, null),
         ($1,$2,'TEXTE-PRIVE-4','error', null, now())`, [payerOrg, ytId]);
    await q(db, `update auth.users set raw_app_meta_data = '{"provider":"google"}' where id = $1`, [payer]);
  });

  it('renvoie le compte, l’organisation, l’abonnement, les canaux et les chiffres de publication', async () => {
    const d = await detail(payer);
    expect(d.user).toMatchObject({ id: payer, email: 'payer@d.test', provider: 'google' });
    expect(d.orgs).toHaveLength(1);
    const [o] = d.orgs;
    expect(o).toMatchObject({ name: 'Cliente payante', role: 'admin', members_count: 1 });
    expect(o.subscription).toMatchObject({ plan: 'team', status: 'active', billing_interval: 'yearly', phase: 'paying', cancel_at_period_end: false });
    expect(o.channels).toEqual([expect.objectContaining({ id: ytId, provider: 'youtube', name: 'Chaîne Payante', username: '@payante', status: 'active' })]);
    expect(o.posts.by_state).toEqual({ published: 2, draft: 1 }); // la publication supprimée n'est pas comptée
    expect(o.posts.last_published_at).not.toBeNull();
  });

  it('la connexion par e-mail est la valeur par défaut', async () => {
    expect((await detail(late)).user.provider).toBe('email');
  });

  it('un utilisateur sans organisation a une liste vide, un essai terminé garde sa phase', async () => {
    expect((await detail(owner)).orgs).toEqual([]);
    expect((await detail(late)).orgs[0].subscription).toMatchObject({ phase: 'trial_expired', status: 'trialing' });
  });

  it('un utilisateur qui appartient à plusieurs organisations les liste toutes, la plus ancienne d’abord', async () => {
    await q(db, `insert into public.memberships (org_id, user_id, role) values ($1, $2, 'viewer')`, [w.orgB, late]);
    const d = await detail(late);
    expect(d.orgs.map((o: any) => [o.name, o.role])).toEqual([['Essai fini', 'admin'], ['Org B', 'viewer']]);
    await q(db, `delete from public.memberships where org_id = $1 and user_id = $2`, [w.orgB, late]);
  });

  it('une organisation sans abonnement a « subscription » à null', async () => {
    await q(db, `delete from public.subscriptions where org_id = $1`, [w.orgB]);
    expect((await detail(w.bob)).orgs[0].subscription).toBeNull();
  });

  it('renvoie null pour un utilisateur inconnu', async () => {
    expect(await detail('00000000-0000-0000-0000-00000000dead')).toBeNull();
  });

  it('ne contient ni le texte des publications ni les jetons des canaux', async () => {
    const json = JSON.stringify(await detail(payer));
    expect(json).not.toContain('TEXTE-PRIVE');
    expect(json).not.toContain('ENC-JETON-SECRET');
  });

  it('est refusée à un utilisateur ordinaire et à un visiteur anonyme', async () => {
    await expect(asUser(db, w.alice, () => q(db, 'select public.admin_user_detail($1)', [payer]))).rejects.toThrow(/forbidden/);
    await expect(asAnon(db, () => q(db, 'select public.admin_user_detail($1)', [payer]))).rejects.toThrow(/permission denied/);
  });
});
