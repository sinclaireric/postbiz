import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const addMedia = (org: string, user: string, mime = 'image/jpeg') =>
  asUser(db, user, () =>
    q<{ id: string; kind: string }>(db,
      `insert into public.media (org_id, path, mime_type, size_bytes, created_by, name) values ($1, $2, $3, 1000, $4, 'photo.jpg') returning id, kind`,
      [org, `${org}/${Math.random().toString(16).slice(2)}-photo.jpg`, mime, user]
    ).then((r) => r[0]!)
  );

const insertPost = (user: string, org: string, integration: string, media: unknown, state = 'draft') =>
  asUser(db, user, () =>
    q<{ id: string }>(db,
      `insert into public.posts (org_id, integration_id, created_by, content, state, media) values ($1,$2,$3,'Bonjour',$4,$5::jsonb) returning id`,
      [org, integration, user, state, JSON.stringify(media)]
    ).then((r) => r[0]!.id)
  );

describe('médias : colonnes et droits', () => {
  it('déduit le type (image / vidéo) du type MIME', async () => {
    expect((await addMedia(w.orgA, w.alice, 'image/png')).kind).toBe('image');
    expect((await addMedia(w.orgA, w.alice, 'video/mp4')).kind).toBe('video');
  });

  it('un membre modifie le texte alternatif de ses médias ; un lecteur ou une autre organisation non', async () => {
    const m = await addMedia(w.orgA, w.carol);
    await asUser(db, w.carol, () => q(db, `update public.media set alt = 'Un canapé en bois' where id = $1`, [m.id]));
    expect((await q<{ alt: string }>(db, 'select alt from public.media where id = $1', [m.id]))[0]!.alt).toBe('Un canapé en bois');
    const asViewer = await asUser(db, w.dave, () => q(db, `update public.media set alt = 'x' where id = $1 returning id`, [m.id]));
    expect(asViewer).toHaveLength(0);
    const asOther = await asUser(db, w.bob, () => q(db, `update public.media set alt = 'x' where id = $1 returning id`, [m.id]));
    expect(asOther).toHaveLength(0);
    expect((await q<{ alt: string }>(db, 'select alt from public.media where id = $1', [m.id]))[0]!.alt).toBe('Un canapé en bois');
  });

  it('les colonnes de chemin et d’organisation ne sont pas modifiables par un client', async () => {
    const m = await addMedia(w.orgA, w.alice);
    await expect(asUser(db, w.alice, () => q(db, `update public.media set path = 'autre' where id = $1`, [m.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.media set org_id = $2 where id = $1`, [m.id, w.orgB]))).rejects.toThrow(/permission denied/);
  });
});

describe('médias : enregistrement', () => {
  const insert = (user: string, org: string, cols: string, vals: unknown[]) =>
    asUser(db, user, () => q(db, `insert into public.media (org_id, created_by, mime_type, ${cols}) values ($1, $2, 'image/jpeg', ${vals.map((_, i) => `$${i + 3}`).join(', ')})`, [org, user, ...vals]));

  it('accepte un fichier du dossier de l’organisation', async () => {
    await insert(w.alice, w.orgA, 'path', [`${w.orgA}/ok.jpg`]);
    await insert(w.alice, w.orgA, 'path, thumbnail_path, normalized_path', [`${w.orgA}/ok2.png`, `${w.orgA}/ok2-thumb.jpg`, `${w.orgA}/ok2.jpg`]);
  });

  it('refuse le fichier d’une autre organisation, un autre bucket et un chemin hors dossier', async () => {
    await expect(insert(w.alice, w.orgA, 'path', [`${w.orgB}/vole.jpg`])).rejects.toThrow(/row-level security/);
    await expect(insert(w.alice, w.orgA, 'path', ['sans-dossier.jpg'])).rejects.toThrow(/row-level security/);
    await expect(insert(w.alice, w.orgA, 'path, thumbnail_path', [`${w.orgA}/a.jpg`, `${w.orgB}/vole-thumb.jpg`])).rejects.toThrow(/row-level security/);
    await expect(insert(w.alice, w.orgA, 'path, normalized_path', [`${w.orgA}/a.png`, `${w.orgB}/vole.jpg`])).rejects.toThrow(/row-level security/);
    await expect(insert(w.alice, w.orgA, 'path, bucket', [`${w.orgA}/a.jpg`, 'autre'])).rejects.toThrow(/row-level security/);
  });

  it('un lecteur ne peut rien enregistrer', async () => {
    await expect(insert(w.dave, w.orgA, 'path', [`${w.orgA}/lecteur.jpg`])).rejects.toThrow(/row-level security/);
  });
});

describe('posts.media : garde', () => {
  it('accepte des médias de l’organisation', async () => {
    const a = await addMedia(w.orgA, w.alice);
    const b = await addMedia(w.orgA, w.alice, 'video/mp4');
    const id = await insertPost(w.alice, w.orgA, w.intA, [{ media_id: a.id, type: 'image' }, { media_id: b.id, type: 'video', alt: 'Visite' }]);
    const [row] = await q<{ media: { media_id: string }[] }>(db, 'select media from public.posts where id = $1', [id]);
    expect(row!.media.map((x) => x.media_id)).toEqual([a.id, b.id]);
  });

  it('refuse le média d’une autre organisation, à la création comme à la modification', async () => {
    const other = await addMedia(w.orgB, w.bob);
    await expect(insertPost(w.alice, w.orgA, w.intA, [{ media_id: other.id, type: 'image' }])).rejects.toThrow(/n'appartient pas/);
    const mine = await addMedia(w.orgA, w.alice);
    const id = await insertPost(w.alice, w.orgA, w.intA, [{ media_id: mine.id, type: 'image' }]);
    await expect(asUser(db, w.alice, () => q(db, `update public.posts set media = $2::jsonb where id = $1`, [id, JSON.stringify([{ media_id: other.id, type: 'image' }])]))).rejects.toThrow(/n'appartient pas/);
  });

  it('refuse un identifiant invalide, un média inexistant, un format qui n’est pas un tableau et plus de 20 médias', async () => {
    await expect(insertPost(w.alice, w.orgA, w.intA, [{ media_id: 'pas-un-uuid', type: 'image' }])).rejects.toThrow(/invalide/);
    await expect(insertPost(w.alice, w.orgA, w.intA, [{ media_id: '00000000-0000-4000-8000-000000000000', type: 'image' }])).rejects.toThrow(/n'appartient pas/);
    await expect(insertPost(w.alice, w.orgA, w.intA, [{ type: 'image' }])).rejects.toThrow();
    await expect(insertPost(w.alice, w.orgA, w.intA, { media_id: 'x' })).rejects.toThrow(/tableau/);
    const m = await addMedia(w.orgA, w.alice);
    await expect(insertPost(w.alice, w.orgA, w.intA, Array.from({ length: 21 }, () => ({ media_id: m.id, type: 'image' })))).rejects.toThrow(/trop de médias/);
  });

  it('une modification qui ne touche pas aux médias reste libre', async () => {
    const m = await addMedia(w.orgA, w.alice);
    const id = await insertPost(w.alice, w.orgA, w.intA, [{ media_id: m.id, type: 'image' }]);
    await asUser(db, w.alice, () => q(db, `update public.posts set content = 'Nouveau texte' where id = $1`, [id]));
    expect((await q<{ content: string }>(db, 'select content from public.posts where id = $1', [id]))[0]!.content).toBe('Nouveau texte');
  });
});

describe('media_usage', () => {
  it('compte les publications en attente qui utilisent un média, pas les publiées ni les supprimées', async () => {
    const used = await addMedia(w.orgA, w.alice);
    const free = await addMedia(w.orgA, w.alice);
    await insertPost(w.alice, w.orgA, w.intA, [{ media_id: used.id, type: 'image' }]);
    const queued = await insertPost(w.alice, w.orgA, w.intA, [{ media_id: used.id, type: 'image' }], 'draft');
    await q(db, `update public.posts set state = 'published' where id = $1`, [queued]); // service : publiée
    const deleted = await insertPost(w.alice, w.orgA, w.intA, [{ media_id: used.id, type: 'image' }]);
    await q(db, `update public.posts set deleted_at = now() where id = $1`, [deleted]);
    const rows = await asUser(db, w.alice, () => q<{ media_id: string; post_count: number }>(db, 'select * from public.media_usage($1::uuid[])', [[used.id, free.id]]));
    const byId = Object.fromEntries(rows.map((r) => [r.media_id, r.post_count]));
    expect(byId[used.id]).toBe(1);
    expect(byId[free.id]).toBe(0);
  });
});
