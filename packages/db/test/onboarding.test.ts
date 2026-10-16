import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createDb, createUser, q, type Db } from './harness';

let db: Db;
beforeAll(async () => {
  db = await createDb();
});

const ensure = (userId: string, name?: string) =>
  asUser(db, userId, async () =>
    (await q<{ id: string }>(db, name === undefined ? 'select public.ensure_organization() as id' : 'select public.ensure_organization($1) as id', name === undefined ? [] : [name]))[0]!.id
  );

describe('ensure_organization', () => {
  it('crée une organisation dont l’appelant est administrateur', async () => {
    const u = await createUser(db, 'new@x.test');
    const org = await ensure(u, 'Espace de Léa');
    const rows = await q<{ role: string; name: string }>(db, 'select m.role, o.name from public.memberships m join public.organizations o on o.id = m.org_id where m.user_id = $1', [u]);
    expect(rows).toEqual([{ role: 'admin', name: 'Espace de Léa' }]);
    expect(org).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('est idempotente : un deuxième appel renvoie la même organisation, sans en créer une autre', async () => {
    const u = await createUser(db, 'twice@x.test');
    const a = await ensure(u, 'Premier nom');
    const b = await ensure(u, 'Autre nom');
    expect(b).toBe(a);
    expect(await q(db, 'select 1 from public.memberships where user_id = $1', [u])).toHaveLength(1);
  });

  it('un utilisateur déjà membre d’une organisation n’en reçoit pas une nouvelle', async () => {
    const owner = await createUser(db, 'owner@x.test');
    const guest = await createUser(db, 'guest@x.test');
    const org = await ensure(owner, 'Équipe');
    await q(db, `insert into public.memberships (org_id, user_id, role) values ($1, $2, 'member')`, [org, guest]);
    expect(await ensure(guest, 'Ne doit pas être créée')).toBe(org);
    expect(await q(db, `select 1 from public.organizations where name = 'Ne doit pas être créée'`)).toHaveLength(0);
  });

  it('deux utilisateurs ont des organisations distinctes et isolées', async () => {
    const a = await createUser(db, 'a2@x.test');
    const b = await createUser(db, 'b2@x.test');
    const orgA = await ensure(a, 'A');
    const orgB = await ensure(b, 'B');
    expect(orgA).not.toBe(orgB);
    const seen = await asUser(db, a, () => q<{ id: string }>(db, 'select id from public.organizations'));
    expect(seen.map((r) => r.id)).toContain(orgA);
    expect(seen.map((r) => r.id)).not.toContain(orgB);
  });

  it('utilise un nom par défaut quand le nom est vide, et tronque un nom trop long', async () => {
    const u = await createUser(db, 'empty@x.test');
    await ensure(u, '   ');
    expect((await q<{ name: string }>(db, 'select o.name from public.organizations o join public.memberships m on m.org_id = o.id where m.user_id = $1', [u]))[0]!.name).toBe('Mon espace');
    const v = await createUser(db, 'long@x.test');
    await ensure(v, 'x'.repeat(300));
    expect((await q<{ name: string }>(db, 'select o.name from public.organizations o join public.memberships m on m.org_id = o.id where m.user_id = $1', [v]))[0]!.name).toHaveLength(120);
  });

  it('sans paramètre, utilise le nom par défaut', async () => {
    const u = await createUser(db, 'noname@x.test');
    await ensure(u);
    expect((await q<{ name: string }>(db, 'select o.name from public.organizations o join public.memberships m on m.org_id = o.id where m.user_id = $1', [u]))[0]!.name).toBe('Mon espace');
  });

  it('exige une session et est inaccessible aux visiteurs anonymes', async () => {
    await expect(q(db, 'select public.ensure_organization()')).rejects.toThrow(/not authenticated/);
    await expect(asAnon(db, () => q(db, 'select public.ensure_organization()'))).rejects.toThrow(/permission denied/);
  });
});
