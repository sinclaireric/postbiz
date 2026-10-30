import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, asService, asUser, createDb, createUser, q, type Db } from './harness';

// Les plafonds de la base de connaissance suivent l'offre de l'espace (migration 20261106000001) : `knowledge_org_limits`, et les fonctions qui s'en servent.

let db: Db;
beforeAll(async () => {
  db = await createDb();
});

const fail = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'aucune erreur';
  } catch (e) {
    return (e as Error).message;
  }
};

let orgCount = 0;
/** Un espace neuf (un essai de 14 jours de l'offre Standard, comme à la création), avec un administrateur, un membre et un lecteur. */
async function freshOrg() {
  const n = ++orgCount;
  const [admin, member, viewer, stranger] = await Promise.all([`pa${n}@x.test`, `pm${n}@x.test`, `pv${n}@x.test`, `ps${n}@x.test`].map((e) => createUser(db, e)));
  const org = await asUser(db, admin!, async () => (await q<{ id: string }>(db, `select public.create_organization($1) as id`, [`Espace ${n}`]))[0]!.id);
  await q(db, `insert into public.memberships (org_id, user_id, role) values ($1,$2,'member'), ($1,$3,'viewer')`, [org, member, viewer]);
  return { org, admin: admin!, member: member!, viewer: viewer!, stranger: stranger! };
}

const billing = (on: boolean) => q(db, 'update public.billing_settings set enabled = $1', [on]);
type Plan = 'free' | 'standard' | 'team' | 'agency';
const onPlan = (org: string, plan: Plan) =>
  plan === 'free'
    ? q(db, `update public.subscriptions set trial_ends_at = now() - interval '1 day' where org_id = $1`, [org])
    : q(db, `update public.subscriptions set status = 'active', plan = $2, trial_ends_at = null, current_period_end = now() + interval '9 days' where org_id = $1`, [org, plan]);

const limitsOf = (user: string, org: string) =>
  asUser(db, user, () => q<{ files: number; sites: number; sources: number; chunks: number; upgradable: boolean }>(db, `select * from public.knowledge_org_limits($1)`, [org])).then((r) => r[0]!);
const path = (org: string, i: number) => `${org}/00000000-0000-4000-8000-${String(i).padStart(12, '0')}-doc${i}.pdf`;
const addFile = (user: string, org: string, i: number) =>
  asUser(db, user, () => q<{ id: string }>(db, `select public.knowledge_add_file($1, $2, $3, 1000) as id`, [org, path(org, i), `Document ${i}`]).then((r) => r[0]!.id));
const addSite = (user: string, org: string, i: number) =>
  asUser(db, user, () => q<{ id: string }>(db, `select public.knowledge_add_website($1, $2, $3, 'page', false) as id`, [org, `https://site${i}.exemple.fr/`, `Site ${i}`]).then((r) => r[0]!.id));
const write = (id: string, chunks: number) =>
  asService(db, () => q<{ n: number }>(db, `select public.knowledge_source_write($1, $2::jsonb, true, '{}') as n`, [id, JSON.stringify(Array.from({ length: chunks }, (_, i) => ({ content: `passage ${i}`, embedding: null, meta: {} })))]));
const texts = (org: string, user: string, count: number) =>
  q(db, `insert into public.knowledge_items (org_id, title, content, created_by) select $1, 'Fiche ' || g, 'Texte.', $2 from generate_series(1, $3::int) g`, [org, user, count]);

describe('knowledge_org_limits : les limites de l’espace', () => {
  it('facturation désactivée (bêta gratuite) : les plafonds de sécurité d’avant, quelle que soit l’offre', async () => {
    await billing(false);
    const { org, admin } = await freshOrg();
    for (const plan of ['free', 'standard', 'agency'] as const) {
      await onPlan(org, plan);
      expect(await limitsOf(admin, org)).toEqual({ files: 40, sites: 5, sources: 100, chunks: 3000, upgradable: false });
    }
  });

  it('facturation activée : l’offre fixe documents et sites, et les plafonds globaux la suivent', async () => {
    await billing(true);
    const { org, admin } = await freshOrg();
    // `upgradable` : une offre supérieure relèverait les plafonds, sauf pour l'offre la plus haute.
    const expected: Record<Plan, { files: number; sites: number; sources: number; chunks: number; upgradable: boolean }> = {
      free: { files: 5, sites: 1, sources: 100, chunks: 3000, upgradable: true },
      standard: { files: 20, sites: 3, sources: 100, chunks: 3450, upgradable: true },
      team: { files: 40, sites: 5, sources: 100, chunks: 6750, upgradable: true },
      agency: { files: 80, sites: 20, sources: 150, chunks: 15000, upgradable: false },
    };
    for (const plan of ['free', 'standard', 'team', 'agency'] as const) {
      await onPlan(org, plan);
      expect(await limitsOf(admin, org), plan).toEqual(expected[plan]);
    }
    await billing(false);
  });

  it('un membre et un lecteur les lisent ; un étranger à l’espace est refusé', async () => {
    await billing(true);
    const { org, member, viewer, stranger } = await freshOrg();
    expect((await limitsOf(member, org)).files).toBe(20);
    expect((await limitsOf(viewer, org)).files).toBe(20);
    expect(await fail(limitsOf(stranger, org))).toMatch(/forbidden/);
    await billing(false);
  });

  it('le service (le worker) les lit aussi, sans être membre', async () => {
    await billing(true);
    const { org } = await freshOrg();
    await onPlan(org, 'free');
    const [row] = await asService(db, () => q<{ files: number }>(db, `select * from public.knowledge_org_limits($1)`, [org]));
    expect(row!.files).toBe(5);
    await billing(false);
  });
});

describe('documents et sites : le plafond de l’offre s’applique, et le refus le dit', () => {
  it('offre Gratuit : 5 documents et 1 site ; le refus porte le plafond ; une offre supérieure en libère', async () => {
    await billing(true);
    const { org, member } = await freshOrg();
    await onPlan(org, 'free');
    for (let i = 1; i <= 5; i++) await addFile(member, org, i);
    expect(await fail(addFile(member, org, 6))).toMatch(/knowledge_files_limit:5/);
    await addSite(member, org, 1);
    expect(await fail(addSite(member, org, 2))).toMatch(/knowledge_sites_limit:1/);

    await onPlan(org, 'standard');
    await addFile(member, org, 6);
    await addSite(member, org, 2);
    await addSite(member, org, 3);
    expect(await fail(addSite(member, org, 4))).toMatch(/knowledge_sites_limit:3/);
    await billing(false);
  });

  it('facturation désactivée : 40 documents et 5 sites comme avant, le refus porte ces nombres', async () => {
    await billing(false);
    const { org, member } = await freshOrg();
    for (let i = 1; i <= 5; i++) await addSite(member, org, i);
    expect(await fail(addSite(member, org, 6))).toMatch(/knowledge_sites_limit:5/);
  });
});

describe('sources en tout : le déclencheur suit l’offre', () => {
  it('Gratuit : 100 sources, la 101e est refusée en disant le plafond', async () => {
    await billing(true);
    const { org, admin } = await freshOrg();
    await onPlan(org, 'free');
    await texts(org, admin, 100);
    expect(await fail(texts(org, admin, 1))).toMatch(/knowledge_items_limit:100/);
    await billing(false);
  });

  it('Agence : 80 documents et 20 sites loges avec 50 fiches de texte, soit 150 sources', async () => {
    await billing(true);
    const { org, admin } = await freshOrg();
    await onPlan(org, 'agency');
    await texts(org, admin, 150);
    expect(await fail(texts(org, admin, 1))).toMatch(/knowledge_items_limit:150/);
    await billing(false);
  });

  it('un membre crée sa fiche de texte sous l’offre Gratuit (le déclencheur lit l’offre avec les droits du membre)', async () => {
    await billing(true);
    const { org, member } = await freshOrg();
    await onPlan(org, 'free');
    const id = await asUser(db, member, async () => (await q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1, 'Ton de la marque', 'Tutoiement.', $2) returning id`, [org, member]))[0]!.id);
    expect(id).toBeTruthy();
    await billing(false);
  });

  it('un étranger à l’espace reçoit le refus de la sécurité par lignes, pas une erreur d’offre (facturation active ou non)', async () => {
    const { org, stranger } = await freshOrg();
    for (const on of [true, false]) {
      await billing(on);
      const insert = asUser(db, stranger, () => q(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1, 'Intrusion', 'Texte.', $2)`, [org, stranger]));
      expect(await fail(insert), String(on)).toMatch(/row-level security/);
    }
    await billing(false);
  });

  it('facturation désactivée : 100 sources comme avant', async () => {
    await billing(false);
    const { org, admin } = await freshOrg();
    await texts(org, admin, 100);
    expect(await fail(texts(org, admin, 1))).toMatch(/knowledge_items_limit:100/);
  });
});

describe('passages en tout : le plafond suit l’offre', () => {
  it('facturation désactivée : 3 000 passages ; le 8e document de 400 passages en dépasse 3 200', async () => {
    await billing(false);
    const { org, member } = await freshOrg();
    for (let i = 1; i <= 7; i++) expect((await write(await addFile(member, org, i), 400))[0]!.n).toBe(400);
    const eighth = await addFile(member, org, 8);
    expect(await fail(write(eighth, 400))).toMatch(/knowledge_chunks_limit/);
    // Les passages d'un autre espace ne comptent pas.
    const other = await freshOrg();
    expect((await write(await addFile(other.member, other.org, 1), 400))[0]!.n).toBe(400);
  });

  it('offre Agence : le même 8e document passe (15 000 passages)', async () => {
    await billing(true);
    const { org, member } = await freshOrg();
    await onPlan(org, 'agency');
    for (let i = 1; i <= 8; i++) expect((await write(await addFile(member, org, i), 400))[0]!.n).toBe(400);
    await billing(false);
  });
});

describe('prérequis de la migration', () => {
  it('s’arrête avec un message clair, sans rien créer, si les offres ne sont pas appliquées', async () => {
    const early = await createDb({ before: '20261103000001_billing.sql' });
    await expect(applyMigration(early, '20261106000001_knowledge_plan_limits.sql')).rejects.toThrow(/Prérequis manquant.*20261103000001_billing/);
    expect(await q(early, `select to_regprocedure('public.knowledge_org_limits(uuid)')::text as f`)).toEqual([{ f: null }]);
  });

  it('s’arrête de même si les documents et les sites ne sont pas appliqués', async () => {
    const early = await createDb({ before: '20261105000001_knowledge_sources.sql' });
    await expect(applyMigration(early, '20261106000001_knowledge_plan_limits.sql')).rejects.toThrow(/Prérequis manquant.*20261105000001_knowledge_sources/);
    expect(await q(early, `select to_regprocedure('public.knowledge_org_limits(uuid)')::text as f`)).toEqual([{ f: null }]);
  });
});
