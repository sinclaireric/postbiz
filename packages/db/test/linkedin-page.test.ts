import { beforeAll, describe, expect, it } from 'vitest';
import { asService, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const connect = (provider: string, internalId: string, settings: object) =>
  asService(db, () =>
    q<{ id: string }>(
      db,
      `select public.connect_integration($1, $2::public.social_provider, $3, $4, null, null, $5::jsonb, null, 'ENC-A', null) as id`,
      [w.orgA, provider, internalId, 'Maison Lune', JSON.stringify(settings)]
    ).then((r) => r[0]!.id)
  );

describe('canal « Page LinkedIn »', () => {
  it('le type de réseau accepte linkedin_page, distinct de linkedin', async () => {
    const values = await q<{ v: string }>(db, `select unnest(enum_range(null::public.social_provider))::text as v`);
    expect(values.map((r) => r.v)).toEqual(expect.arrayContaining(['linkedin', 'linkedin_page']));
  });

  it('le point d’entrée instagram_standalone existe pour la table des connexions en cours', async () => {
    const values = await q<{ v: string }>(db, `select unnest(enum_range(null::public.social_provider))::text as v`);
    expect(values.map((r) => r.v)).toContain('instagram_standalone');
  });

  it('une Page se connecte avec l’auteur d’organisation, à côté du profil du même membre', async () => {
    const page = await connect('linkedin_page', '111', { author_urn: 'urn:li:organization:111', kind: 'page' });
    const person = await connect('linkedin', '111', { author_urn: 'urn:li:person:111' });
    expect(page).not.toBe(person); // même identifiant interne, fournisseurs différents : deux canaux
    const [row] = await q<{ provider: string; settings: { author_urn: string } }>(db, 'select provider::text, settings from public.integrations where id = $1', [page]);
    expect(row).toMatchObject({ provider: 'linkedin_page', settings: { author_urn: 'urn:li:organization:111' } });
  });

  it('un membre voit sa Page dans la liste des canaux de son organisation', async () => {
    const rows = await asUser(db, w.alice, () => q<{ provider: string }>(db, `select provider::text from public.integrations where provider = 'linkedin_page'`));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('un post sur une Page peut recevoir un premier commentaire, comme sur LinkedIn', async () => {
    const page = await connect('linkedin_page', '222', { author_urn: 'urn:li:organization:222' });
    const [post] = await asUser(db, w.alice, () =>
      q<{ first_comment_state: string }>(db,
        `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at, first_comment)
         values ($1,$2,$3,'Bonjour','queued', now() + interval '1 day','Le lien est ici') returning first_comment_state`, [w.orgA, page, w.alice]));
    expect(post!.first_comment_state).toBe('pending');
  });
});
