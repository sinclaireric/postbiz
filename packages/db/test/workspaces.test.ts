import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, asAnon, asService, asUser, createDb, createUser, q, seedWorld, type Db, type World } from './harness';

// Espaces de travail : une personne, plusieurs organisations. On vérifie l'isolation entre espaces, les rôles propres à chacun, le dernier administrateur,
// l'essai unique, les invitations et la suppression.

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const create = (user: string, name: string, copyFrom: string | null = null) =>
  asUser(db, user, async () => (await q<{ id: string }>(db, 'select public.create_organization($1, $2) as id', [name, copyFrom]))[0]!.id);
const newUser = async (email: string, confirmed = true) => {
  const id = await createUser(db, email);
  if (confirmed) await q(db, 'update auth.users set email_confirmed_at = now() where id = $1', [id]);
  return id;
};
const roleOf = async (org: string, user: string) => (await q<{ role: string }>(db, 'select role::text from public.memberships where org_id = $1 and user_id = $2', [org, user]))[0]?.role;
const addMember = (org: string, user: string, role: string) => q(db, 'insert into public.memberships (org_id, user_id, role) values ($1, $2, $3)', [org, user, role]);
const post = (user: string, org: string, integration: string) =>
  asUser(db, user, () => q(db, `insert into public.posts (org_id, integration_id, content, created_by, state) values ($1, $2, 'x', $3, 'draft') returning id`, [org, integration, user]));

describe('create_organization', () => {
  it('l’appelant en devient administrateur ; le nom est nettoyé et limité à 120 caractères', async () => {
    const u = await newUser('cree@x.test');
    const org = await create(u, '   Atelier   des   Lilas  ');
    expect((await q<{ name: string }>(db, 'select name from public.organizations where id = $1', [org]))[0]!.name).toBe('Atelier des Lilas');
    expect(await roleOf(org, u)).toBe('admin');
    const long = await create(u, 'é'.repeat(300));
    expect((await q<{ n: number }>(db, 'select char_length(name) as n from public.organizations where id = $1', [long]))[0]!.n).toBe(120);
  });

  it('refuse un nom vide, un visiteur anonyme et un compte suspendu', async () => {
    const u = await newUser('refus@x.test');
    await expect(create(u, '   \n ')).rejects.toThrow(/invalid_name/);
    await expect(asAnon(db, () => q(db, `select public.create_organization('X')`))).rejects.toThrow();
    await q(db, 'insert into public.user_suspensions (user_id) values ($1)', [u]);
    await expect(create(u, 'Nouveau')).rejects.toThrow(/suspended/);
  });

  it('le mobile appelle toujours create_organization(p_name) avec le seul nom', async () => {
    const u = await newUser('mobile@x.test');
    const id = await asUser(db, u, async () => (await q<{ id: string }>(db, 'select public.create_organization(p_name := $1) as id', ['Depuis le mobile']))[0]!.id);
    expect(await roleOf(id, u)).toBe('admin');
  });

  it('il faut être administrateur d’au moins un espace : un simple membre ou lecteur n’en crée pas', async () => {
    const guest = await newUser('invite-seul@x.test');
    await addMember(w.orgA, guest, 'viewer');
    await expect(create(guest, 'Mon propre espace')).rejects.toThrow(/not_admin/);
    await addMember(w.orgB, guest, 'admin');
    await expect(create(guest, 'Maintenant oui')).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it('10 espaces créés au plus par personne ; en supprimer un libère une place', async () => {
    const u = await newUser('dix@x.test');
    const orgs: string[] = [];
    for (let i = 1; i <= 10; i++) orgs.push(await create(u, `Espace ${i}`));
    await expect(create(u, 'Onzième')).rejects.toThrow(/workspace_limit/);
    await asUser(db, u, () => q(db, 'select public.delete_workspace($1)', [orgs[9]]));
    await expect(create(u, 'Onzième')).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it('peut reprendre les membres d’un autre espace, avec leur rôle, à condition d’en être administrateur', async () => {
    const lead = await newUser('chef-copie@x.test');
    const source = await create(lead, 'Source');
    const [m, v] = [await newUser('m-copie@x.test'), await newUser('v-copie@x.test')];
    await addMember(source, m, 'member');
    await addMember(source, v, 'viewer');
    const copy = await create(lead, 'Copie', source);
    const rows = await q<{ user_id: string; role: string }>(db, 'select user_id, role::text from public.memberships where org_id = $1', [copy]);
    expect(rows).toHaveLength(3);
    expect(await roleOf(copy, lead)).toBe('admin');
    expect(await roleOf(copy, m)).toBe('member');
    expect(await roleOf(copy, v)).toBe('viewer');
    // Un membre de la source qui n'en est pas administrateur ne peut pas en emmener les membres (même s'il administre un autre espace).
    await addMember(w.orgB, m, 'admin');
    await expect(create(m, 'Vol de membres', source)).rejects.toThrow(/forbidden/);
    // Ni un espace dont on n'est pas membre.
    await expect(create(w.bob, 'Espion', source)).rejects.toThrow(/forbidden/);
    expect(await q(db, `select 1 from public.organizations where name in ('Vol de membres', 'Espion')`)).toHaveLength(0);
  });
});

describe('isolation entre espaces', () => {
  let eve: string; // membre de A (membre) et de B (lecteur), sans autre espace
  let orgC: string; // espace de Frank, que personne d'autre ne connaît
  let frank: string;
  let intC: string;

  beforeAll(async () => {
    eve = await newUser('eve@x.test');
    frank = await newUser('frank@x.test');
    await addMember(w.orgA, eve, 'member');
    await addMember(w.orgB, eve, 'viewer');
    orgC = await create(frank, 'Espace de Frank');
    intC = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1, 'instagram', 'ig-c', 'Compte C') returning id`, [orgC]))[0]!.id;
  });

  it('une personne membre de deux espaces voit les deux, et chaque requête filtrée par espace ne rend que le sien', async () => {
    await asUser(db, eve, async () => {
      expect((await q<{ id: string }>(db, 'select id from public.organizations')).map((o) => o.id).sort()).toEqual([w.orgA, w.orgB].sort());
      expect((await q<{ id: string }>(db, 'select id from public.integrations where org_id = $1', [w.orgA])).map((i) => i.id)).toEqual([w.intA]);
      expect((await q<{ id: string }>(db, 'select id from public.integrations where org_id = $1', [w.orgB])).map((i) => i.id)).toEqual([w.intB]);
    });
  });

  it('ses rôles sont propres à chaque espace : membre dans A, elle publie ; lecteur dans B, elle ne publie pas', async () => {
    await expect(post(eve, w.orgA, w.intA)).resolves.toHaveLength(1);
    await expect(post(eve, w.orgB, w.intB)).rejects.toThrow(/row-level security/);
  });

  it('un canal d’un espace ne peut pas porter une publication d’un autre', async () => {
    await expect(post(eve, w.orgA, w.intB)).rejects.toThrow(/row-level security/);
  });

  it('une personne qui n’est membre d’aucun espace ne voit rien', async () => {
    const stranger = await newUser('etranger@x.test');
    await asUser(db, stranger, async () => {
      for (const t of ['organizations', 'memberships', 'integrations', 'posts', 'media', 'subscriptions', 'workspace_invitations']) {
        expect(await q(db, `select 1 from public.${t}`), t).toHaveLength(0);
      }
      expect(await q(db, 'select * from public.my_invitations()')).toHaveLength(0);
      await expect(q(db, 'select * from public.workspace_members($1)', [w.orgA])).rejects.toThrow(/forbidden/);
    });
  });

  it('un membre de A et B ne voit rien de l’espace C, ni ses membres ni ses canaux', async () => {
    await asUser(db, eve, async () => {
      expect(await q(db, 'select 1 from public.integrations where id = $1', [intC])).toHaveLength(0);
      expect(await q(db, 'select 1 from public.memberships where org_id = $1', [orgC])).toHaveLength(0);
      expect(await q(db, 'select 1 from public.organizations where id = $1', [orgC])).toHaveLength(0);
    });
  });

  it('quitter un espace ne retire rien des autres', async () => {
    const leaver = await newUser('part@x.test');
    await addMember(w.orgA, leaver, 'member');
    await addMember(w.orgB, leaver, 'member');
    await asUser(db, leaver, () => q(db, 'delete from public.memberships where org_id = $1 and user_id = $2', [w.orgA, leaver]));
    expect(await roleOf(w.orgA, leaver)).toBeUndefined();
    expect(await roleOf(w.orgB, leaver)).toBe('member');
  });
});

describe('dernier administrateur', () => {
  it('l’unique administrateur ne peut ni se retirer ni se rétrograder ; avec un second administrateur, oui', async () => {
    const boss = await newUser('boss@x.test');
    const org = await create(boss, 'Équipe');
    const deputy = await newUser('adjoint@x.test');
    await addMember(org, deputy, 'member');
    await expect(asUser(db, boss, () => q(db, 'delete from public.memberships where org_id = $1 and user_id = $2', [org, boss]))).rejects.toThrow(/last_admin/);
    await expect(asUser(db, boss, () => q(db, `update public.memberships set role = 'member' where org_id = $1 and user_id = $2`, [org, boss]))).rejects.toThrow(/last_admin/);
    expect(await roleOf(org, boss)).toBe('admin');

    await asUser(db, boss, () => q(db, `update public.memberships set role = 'admin' where org_id = $1 and user_id = $2`, [org, deputy]));
    await asUser(db, boss, () => q(db, `update public.memberships set role = 'viewer' where org_id = $1 and user_id = $2`, [org, boss]));
    expect(await roleOf(org, boss)).toBe('viewer');
    // L'adjoint est désormais le dernier : lui non plus ne peut pas partir.
    await expect(asUser(db, deputy, () => q(db, 'delete from public.memberships where org_id = $1 and user_id = $2', [org, deputy]))).rejects.toThrow(/last_admin/);
  });

  it('un administrateur retire n’importe quel membre, et un membre peut toujours partir', async () => {
    const boss = await newUser('boss2@x.test');
    const member = await newUser('membre2@x.test');
    const org = await create(boss, 'Équipe 2');
    await addMember(org, member, 'member');
    await asUser(db, member, () => q(db, 'delete from public.memberships where org_id = $1 and user_id = $2', [org, member]));
    expect(await roleOf(org, member)).toBeUndefined();
  });

  it('un membre ordinaire ne change pas les rôles', async () => {
    const boss = await newUser('boss3@x.test');
    const member = await newUser('membre3@x.test');
    const org = await create(boss, 'Équipe 3');
    await addMember(org, member, 'member');
    const res = await asUser(db, member, () => q(db, `update public.memberships set role = 'admin' where org_id = $1 and user_id = $2 returning user_id`, [org, member]));
    expect(res).toHaveLength(0);
    expect(await roleOf(org, member)).toBe('member');
  });

  it('supprimer le compte de l’unique administrateur, ou l’espace lui-même, n’est pas bloqué', async () => {
    const boss = await newUser('boss4@x.test');
    const org = await create(boss, 'À supprimer');
    await q(db, 'delete from auth.users where id = $1', [boss]);
    expect(await q(db, 'select 1 from public.memberships where org_id = $1', [org])).toHaveLength(0);

    const other = await newUser('boss5@x.test');
    const org2 = await create(other, 'À supprimer aussi');
    await q(db, 'delete from public.organizations where id = $1', [org2]);
    expect(await q(db, 'select 1 from public.memberships where org_id = $1', [org2])).toHaveLength(0);
  });
});

describe('essai gratuit : un seul par personne', () => {
  const sub = async (org: string) =>
    (await q<{ phase: string; ends: string; days: number }>(db,
      `select public.subscription_phase(status, trial_ends_at) as phase, trial_ends_at::text as ends, round(extract(epoch from trial_ends_at - now()) / 86400)::int as days
       from public.subscriptions where org_id = $1`, [org]))[0]!;

  it('le premier espace a 14 jours ; les suivants reprennent la même date de fin, sans nouvel essai', async () => {
    const u = await newUser('essai@x.test');
    const first = await create(u, 'Premier');
    expect(await sub(first)).toMatchObject({ phase: 'trialing', days: 14 });
    const second = await create(u, 'Deuxième');
    const third = await create(u, 'Troisième');
    expect((await sub(second)).ends).toBe((await sub(first)).ends);
    expect((await sub(third)).ends).toBe((await sub(first)).ends);
  });

  it('un espace créé après la fin de l’essai apparaît « essai terminé » ; supprimer le premier espace ne relance pas l’essai', async () => {
    const u = await newUser('essai2@x.test');
    const first = await create(u, 'Premier');
    const second = await create(u, 'Deuxième');
    await q(db, `update public.user_trials set started_at = now() - interval '20 days' where user_id = $1`, [u]);
    const late = await create(u, 'Tardif');
    expect((await sub(late)).phase).toBe('trial_expired');
    await asUser(db, u, () => q(db, 'select public.delete_workspace($1)', [first]));
    await asUser(db, u, () => q(db, 'select public.delete_workspace($1)', [second]));
    const again = await create(u, 'Encore');
    expect((await sub(again)).phase).toBe('trial_expired');
    expect(await q(db, 'select 1 from public.user_trials where user_id = $1', [u])).toHaveLength(1);
  });

  it('chaque personne a son propre essai de 14 jours', async () => {
    const a = await newUser('essai-a@x.test');
    const b = await newUser('essai-b@x.test');
    await create(a, 'A1');
    expect((await sub(await create(b, 'B1'))).days).toBe(14);
  });

  it('une organisation sans créateur (éditeur SQL, service_role) a l’essai habituel et n’enregistre aucun essai personnel', async () => {
    const before = (await q<{ n: number }>(db, 'select count(*)::int as n from public.user_trials'))[0]!.n;
    const org = (await q<{ id: string }>(db, `insert into public.organizations (name) values ('Sans créateur') returning id`))[0]!.id;
    expect((await sub(org)).days).toBe(14);
    expect((await q<{ n: number }>(db, 'select count(*)::int as n from public.user_trials'))[0]!.n).toBe(before);
  });

  it('un client ne lit ni n’écrit les essais', async () => {
    const u = await newUser('essai3@x.test');
    await asUser(db, u, async () => {
      await expect(q(db, 'select * from public.user_trials')).rejects.toThrow(/permission denied/);
      await expect(q(db, `insert into public.user_trials (user_id) values ($1)`, [u])).rejects.toThrow(/permission denied/);
    });
  });
});

describe('reprise de l’existant', () => {
  it('garde la date de début d’essai de ceux qui en ont eu un ; la bêta sans abonnement n’en reçoit pas', async () => {
    const old = await createDb({ before: '20261102000001_workspaces.sql' });
    const x = (await q<{ id: string }>(old, `insert into auth.users (email) values ('x@old.test') returning id`))[0]!.id;
    const y = (await q<{ id: string }>(old, `insert into auth.users (email) values ('y@old.test') returning id`))[0]!.id;
    const orgX = (await q<{ id: string }>(old, `insert into public.organizations (name, created_by) values ('X', $1) returning id`, [x]))[0]!.id;
    const orgY = (await q<{ id: string }>(old, `insert into public.organizations (name, created_by) values ('Bêta', $1) returning id`, [y]))[0]!.id;
    await q(old, `update public.subscriptions set created_at = now() - interval '5 days', trial_ends_at = now() + interval '9 days' where org_id = $1`, [orgX]);
    await q(old, 'delete from public.subscriptions where org_id = $1', [orgY]);

    await applyMigration(old, '20261102000001_workspaces.sql');
    const rows = await q<{ user_id: string; days: number }>(old, `select user_id, round(extract(epoch from now() - started_at) / 86400)::int as days from public.user_trials`);
    expect(rows).toEqual([{ user_id: x, days: 5 }]);
  });
});

describe('invitations', () => {
  let org: string;
  let boss: string;
  let member: string;
  const invite = (user: string, email: string, role = 'member', target = org) =>
    asUser(db, user, async () => (await q<{ t: string }>(db, 'select public.invite_to_workspace($1, $2, $3) as t', [target, email, role]))[0]!.t);
  const accept = (user: string, token: string) =>
    asUser(db, user, async () => (await q<{ id: string }>(db, 'select public.accept_invitation($1) as id', [token]))[0]!.id);

  beforeAll(async () => {
    boss = await newUser('boss-inv@x.test');
    member = await newUser('membre-inv@x.test');
    org = await create(boss, 'Agence');
    await addMember(org, member, 'member');
  });

  it('un administrateur invite : le jeton est long et aléatoire, la base n’en garde que l’empreinte', async () => {
    const t1 = await invite(boss, 'Nora@Example.test ');
    const t2 = await invite(boss, 'hugo@example.test');
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
    const rows = await q<{ email: string; token_hash: string }>(db, 'select email, token_hash from public.workspace_invitations where org_id = $1 order by email', [org]);
    expect(rows.map((r) => r.email)).toEqual(['hugo@example.test', 'nora@example.test']);
    expect(rows.every((r) => r.token_hash !== t1 && r.token_hash !== t2 && /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });

  it('seuls les administrateurs invitent, voient les invitations en attente et les révoquent ; jamais l’empreinte du jeton', async () => {
    await expect(invite(member, 'x@example.test')).rejects.toThrow(/forbidden/);
    await expect(invite(w.bob, 'x@example.test')).rejects.toThrow(/forbidden/);
    await asUser(db, member, async () => expect(await q(db, 'select 1 from public.workspace_invitations')).toHaveLength(0));
    await asUser(db, boss, async () => {
      expect((await q<{ email: string }>(db, 'select email from public.workspace_invitations order by email')).length).toBeGreaterThanOrEqual(2);
      await expect(q(db, 'select token_hash from public.workspace_invitations')).rejects.toThrow(/permission denied/);
      await expect(q(db, 'select * from public.workspace_invitations')).rejects.toThrow(/permission denied/);
    });
    const del = await asUser(db, member, () => q(db, `delete from public.workspace_invitations where org_id = $1 returning id`, [org]));
    expect(del).toHaveLength(0);
    await invite(boss, 'asupprimer@example.test');
    await asUser(db, boss, () => q(db, `delete from public.workspace_invitations where org_id = $1 and email = 'asupprimer@example.test'`, [org]));
    expect(await q(db, `select 1 from public.workspace_invitations where email = 'asupprimer@example.test'`)).toHaveLength(0);
  });

  it('la réponse est la même que l’adresse ait un compte ou non ; seule l’appartenance à son propre espace est refusée', async () => {
    const existing = await newUser('compte-existant@example.test');
    expect(await invite(boss, 'compte-existant@example.test')).toMatch(/^[0-9a-f]{64}$/);
    expect(await invite(boss, 'inconnu-total@example.test')).toMatch(/^[0-9a-f]{64}$/);
    await addMember(org, existing, 'viewer');
    await expect(invite(boss, 'Compte-Existant@example.test')).rejects.toThrow(/already_member/);
  });

  it('refuse une adresse mal formée', async () => {
    for (const bad of ['', 'sans-arobase', 'a@b', 'a b@c.d', 'a@@b.c', `${'x'.repeat(250)}@b.cd`]) {
      await expect(invite(boss, bad), bad).rejects.toThrow(/invalid_email/);
    }
  });

  it('50 invitations en attente au plus par espace', async () => {
    const big = await create(boss, 'Gros espace');
    for (let i = 0; i < 50; i++) await invite(boss, `p${i}@example.test`, 'viewer', big);
    await expect(invite(boss, 'de-trop@example.test', 'viewer', big)).rejects.toThrow(/invitation_limit/);
    // Réinviter une adresse déjà en attente remplace son invitation : pas de dépassement.
    await expect(invite(boss, 'p3@example.test', 'viewer', big)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('inviter de nouveau remplace le lien précédent, qui ne marche plus', async () => {
    const old = await invite(boss, 'relance@example.test', 'viewer');
    const fresh = await invite(boss, 'relance@example.test', 'member');
    expect(fresh).not.toBe(old);
    const guest = await newUser('relance-compte@example.test');
    await expect(accept(guest, old)).rejects.toThrow(/invitation_invalid/);
    const joined = await accept(guest, fresh);
    expect(joined).toBe(org);
    expect(await roleOf(org, guest)).toBe('member');
  });

  it('le lien ne sert qu’une fois, expire au bout de 7 jours et refuse un jeton inventé', async () => {
    const token = await invite(boss, 'une-fois@example.test', 'viewer');
    const first = await newUser('premier@example.test');
    const second = await newUser('second@example.test');
    await accept(first, token);
    expect(await roleOf(org, first)).toBe('viewer');
    await expect(accept(second, token)).rejects.toThrow(/invitation_invalid/);
    expect(await roleOf(org, second)).toBeUndefined();

    const late = await invite(boss, 'tardif@example.test');
    await q(db, `update public.workspace_invitations set expires_at = now() - interval '1 second' where email = 'tardif@example.test'`);
    await expect(accept(second, late)).rejects.toThrow(/invitation_invalid/);
    await expect(accept(second, 'a'.repeat(64))).rejects.toThrow(/invitation_invalid/);
    const days = (await q<{ d: number }>(db, `select round(extract(epoch from expires_at - created_at) / 86400)::int as d from public.workspace_invitations where email = 'une-fois@example.test' or email = 'relance@example.test'`));
    expect(days.every((r) => r.d === 7)).toBe(true);
  });

  it('accepter n’abaisse jamais le rôle d’un membre existant', async () => {
    const token = await invite(boss, 'rolehaut@example.test', 'viewer');
    const user = await newUser('role-haut@example.test');
    await addMember(org, user, 'admin');
    await accept(user, token);
    expect(await roleOf(org, user)).toBe('admin');
  });

  it('la page du lien montre l’espace, le rôle et qui invite ; rien pour un jeton inconnu ; un compte suspendu est refusé', async () => {
    const token = await invite(boss, 'apercu@example.test', 'member');
    const viewer = await newUser('voit@example.test');
    const [p] = await asUser(db, viewer, () => q<any>(db, 'select * from public.invitation_preview($1)', [token]));
    expect(p).toMatchObject({ org_id: org, org_name: 'Agence', role: 'member', inviter_name: 'boss-inv', already_member: false });
    expect(await asUser(db, viewer, () => q(db, 'select * from public.invitation_preview($1)', ['0'.repeat(64)]))).toHaveLength(0);
    const [again] = await asUser(db, boss, () => q<any>(db, 'select * from public.invitation_preview($1)', [token]));
    expect(again.already_member).toBe(true);
    await q(db, 'insert into public.user_suspensions (user_id) values ($1)', [viewer]);
    await expect(asUser(db, viewer, () => q(db, 'select * from public.invitation_preview($1)', [token]))).rejects.toThrow(/suspended/);
    await expect(accept(viewer, token)).rejects.toThrow(/suspended/);
  });

  it('les invitations reçues se retrouvent par l’adresse confirmée du compte, et seulement celle-là', async () => {
    await invite(boss, 'reçue@example.test', 'viewer');
    const confirmed = await newUser('reçue@example.test');
    const unconfirmed = await newUser('autre-reçue@example.test', false);
    await invite(boss, 'autre-reçue@example.test');
    const mine = await asUser(db, confirmed, () => q<any>(db, 'select * from public.my_invitations()'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ org_id: org, org_name: 'Agence', role: 'viewer' });
    // Adresse non confirmée : personne ne peut s'approprier l'invitation en s'inscrivant avec l'adresse d'un autre.
    expect(await asUser(db, unconfirmed, () => q(db, 'select * from public.my_invitations()'))).toHaveLength(0);
    await expect(asUser(db, unconfirmed, () => q(db, 'select public.accept_invitation_by_id($1)', [mine[0].id]))).rejects.toThrow(/invitation_invalid/);
  });

  it('accepter ou refuser une invitation reçue ; un autre compte ne peut ni l’un ni l’autre', async () => {
    await invite(boss, 'choix@example.test', 'member');
    await invite(boss, 'refus@example.test', 'member');
    const chooser = await newUser('choix@example.test');
    const refuser = await newUser('refus@example.test');
    const intruder = await newUser('intrus@example.test');
    const [a] = await asUser(db, chooser, () => q<any>(db, 'select * from public.my_invitations()'));
    const [r] = await asUser(db, refuser, () => q<any>(db, 'select * from public.my_invitations()'));

    await expect(asUser(db, intruder, () => q(db, 'select public.accept_invitation_by_id($1)', [a.id]))).rejects.toThrow(/invitation_invalid/);
    await asUser(db, intruder, () => q(db, 'select public.decline_invitation($1)', [r.id]));
    expect(await q(db, 'select 1 from public.workspace_invitations where id = $1', [r.id])).toHaveLength(1);

    await asUser(db, chooser, () => q(db, 'select public.accept_invitation_by_id($1)', [a.id]));
    expect(await roleOf(org, chooser)).toBe('member');
    expect(await q(db, 'select 1 from public.workspace_invitations where id = $1', [a.id])).toHaveLength(0);

    await asUser(db, refuser, () => q(db, 'select public.decline_invitation($1)', [r.id]));
    expect(await q(db, 'select 1 from public.workspace_invitations where id = $1', [r.id])).toHaveLength(0);
    expect(await roleOf(org, refuser)).toBeUndefined();
  });

  it('un visiteur anonyme ne peut rien de tout cela', async () => {
    await expect(asAnon(db, () => q(db, 'select public.invite_to_workspace($1, $2)', [org, 'a@b.cd']))).rejects.toThrow();
    await expect(asAnon(db, () => q(db, 'select public.accept_invitation($1)', ['x']))).rejects.toThrow();
    await expect(asAnon(db, () => q(db, 'select * from public.my_invitations()'))).rejects.toThrow();
  });

  it('supprimer l’espace emporte ses invitations', async () => {
    const tmp = await create(boss, 'Temporaire');
    await invite(boss, 'tmp@example.test', 'member', tmp);
    await asUser(db, boss, () => q(db, 'select public.delete_workspace($1)', [tmp]));
    expect(await q(db, 'select 1 from public.workspace_invitations where org_id = $1', [tmp])).toHaveLength(0);
  });
});

describe('membres d’un espace', () => {
  it('un administrateur voit les adresses ; un membre ordinaire ne voit que les noms ; un étranger est refusé', async () => {
    const lead = await newUser('lead-membres@x.test');
    const [m, v] = [await newUser('m-membres@x.test'), await newUser('v-membres@x.test')];
    const org = await create(lead, 'Annuaire');
    await addMember(org, m, 'member');
    await addMember(org, v, 'viewer');
    const asAdmin = await asUser(db, lead, () => q<any>(db, 'select * from public.workspace_members($1)', [org]));
    expect(asAdmin.map((x: any) => [x.email, x.role]).sort()).toEqual([['lead-membres@x.test', 'admin'], ['m-membres@x.test', 'member'], ['v-membres@x.test', 'viewer']]);
    const asMember = await asUser(db, m, () => q<any>(db, 'select * from public.workspace_members($1)', [org]));
    expect(asMember).toHaveLength(3);
    expect(asMember.every((x: any) => x.email === null)).toBe(true);
    expect(asMember.map((x: any) => x.name).sort()).toEqual(['lead-membres', 'm-membres', 'v-membres']);
    await expect(asUser(db, w.bob, () => q(db, 'select * from public.workspace_members($1)', [org]))).rejects.toThrow(/forbidden/);
  });
});

describe('supprimer un espace', () => {
  let boss: string;
  beforeAll(async () => {
    boss = await newUser('boss-del@x.test');
    await create(boss, 'Espace principal');
  });
  const del = (user: string, org: string) => asUser(db, user, () => q(db, 'select public.delete_workspace($1)', [org]));

  it('réservé aux administrateurs de l’espace', async () => {
    const org = await create(boss, 'Réservé');
    const member = await newUser('membre-del@x.test');
    await addMember(org, member, 'member');
    await addMember(w.orgB, member, 'admin'); // administrateur ailleurs, pas ici
    await expect(del(member, org)).rejects.toThrow(/forbidden/);
    await expect(del(w.bob, org)).rejects.toThrow(/forbidden/);
    expect(await q(db, 'select 1 from public.organizations where id = $1', [org])).toHaveLength(1);
  });

  it('refuse de supprimer l’unique espace de la personne', async () => {
    const solo = await newUser('solo@x.test');
    const only = await create(solo, 'Seul');
    await expect(del(solo, only)).rejects.toThrow(/last_workspace/);
  });

  it('refuse tant qu’un canal est connecté ou qu’une publication est en file', async () => {
    const org = await create(boss, 'Avec canal');
    const ig = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1, 'instagram', 'ig-del', 'Compte') returning id`, [org]))[0]!.id;
    await expect(del(boss, org)).rejects.toThrow(/has_channels/);
    await q(db, `update public.integrations set deleted_at = now() where id = $1`, [ig]);
    const p = (await q<{ id: string }>(db, `insert into public.posts (org_id, integration_id, content, created_by, state, publish_at) values ($1, $2, 'x', $3, 'queued', now() + interval '1 day') returning id`, [org, ig, boss]))[0]!.id;
    await expect(del(boss, org)).rejects.toThrow(/has_queued_posts/);
    await q(db, `update public.posts set state = 'draft', publish_at = null where id = $1`, [p]);
    await del(boss, org);
    expect(await q(db, 'select 1 from public.organizations where id = $1', [org])).toHaveLength(0);
  });

  it('emporte tout ce que l’espace contient et rien d’un autre espace', async () => {
    const doomed = await create(boss, 'Condamné');
    const spared = await create(boss, 'Épargné');
    for (const org of [doomed, spared]) {
      await q(db, `insert into public.media (org_id, path, created_by) values ($1, $3 || '/a.jpg', $2)`, [org, boss, org]);
      await q(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1, 'Fiche', 'Texte', $2)`, [org, boss]);
      await q(db, `insert into public.agent_threads (org_id, user_id, title) values ($1, $2, 'Échange')`, [org, boss]);
      await q(db, `insert into public.notifications (user_id, org_id, type, title) values ($1, $2, 't', 'N')`, [boss, org]);
    }
    await q(db, `insert into public.memberships (org_id, user_id, role) values ($1, $2, 'member')`, [doomed, w.carol]);
    await del(boss, doomed);
    for (const t of ['memberships', 'media', 'knowledge_items', 'agent_threads', 'notifications', 'subscriptions']) {
      expect(await q(db, `select 1 from public.${t} where org_id = $1`, [doomed]), t).toHaveLength(0);
      expect((await q(db, `select 1 from public.${t} where org_id = $1`, [spared])).length, t).toBeGreaterThan(0);
    }
    expect(await roleOf(w.orgA, w.carol)).toBe('member');
  });

  it('un administrateur de la plateforme voit toujours toutes les organisations d’une personne', async () => {
    const owner = await newUser('proprietaire@x.test');
    await asService(db, () => q(db, 'insert into public.platform_admins (user_id) values ($1)', [owner]));
    const multi = await newUser('multi@x.test');
    await create(multi, 'Un');
    await create(multi, 'Deux');
    const detail = await asUser(db, owner, async () => (await q<{ d: any }>(db, 'select public.admin_user_detail($1) as d', [multi]))[0]!.d);
    expect(detail.orgs.map((o: any) => o.name)).toEqual(['Un', 'Deux']);
    const list = await asUser(db, owner, () => q<any>(db, `select * from public.admin_users($1)`, ['multi@x.test']));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ org_name: 'Un', orgs_count: 2 });
  });
});
