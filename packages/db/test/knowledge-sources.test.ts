import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const fail = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'aucune erreur';
  } catch (e) {
    return (e as Error).message;
  }
};

// Les organisations de ces tests sont créées à la demande : chaque test a la sienne, pour que les plafonds ne se gênent pas.
let orgCount = 0;
async function freshOrg(): Promise<{ org: string; admin: string; member: string; viewer: string }> {
  const n = ++orgCount;
  const [admin, member, viewer] = await Promise.all([`a${n}@x.test`, `m${n}@x.test`, `v${n}@x.test`].map(async (e) => (await q<{ id: string }>(db, `insert into auth.users (email) values ($1) returning id`, [e]))[0]!.id));
  const org = await asUser(db, admin!, async () => (await q<{ id: string }>(db, `select public.create_organization($1) as id`, [`Org ${n}`]))[0]!.id);
  await q(db, `insert into public.memberships (org_id, user_id, role) values ($1,$2,'member'), ($1,$3,'viewer')`, [org, member, viewer]);
  return { org, admin: admin!, member: member!, viewer: viewer! };
}

const path = (org: string, name = 'catalogue.pdf') => `${org}/00000000-0000-4000-8000-000000000001-${name}`;
const addFile = (user: string, org: string, p: string, title = 'Catalogue', size: number | null = 12_345) =>
  asUser(db, user, () => q<{ id: string }>(db, `select public.knowledge_add_file($1, $2, $3, $4) as id`, [org, p, title, size]).then((r) => r[0]!.id));
const addSite = (user: string, org: string, url: string, o: { title?: string; scope?: string; auto?: boolean } = {}) =>
  asUser(db, user, () => q<{ id: string }>(db, `select public.knowledge_add_website($1, $2, $3, $4, $5) as id`, [org, url, o.title ?? 'Mon site', o.scope ?? 'site', o.auto ?? true]).then((r) => r[0]!.id));
const item = (id: string) => q<Record<string, any>>(db, `select * from public.knowledge_items where id = $1`, [id]).then((r) => r[0]!);
const claim = (limit = 1, lock = 180) => asService(db, () => q<Record<string, any>>(db, `select * from public.claim_knowledge_sources($1, $2)`, [limit, lock]));
const write = (id: string, chunks: unknown, replace = false, drop: string[] = []) =>
  asService(db, () => q<{ n: number }>(db, `select public.knowledge_source_write($1, $2::jsonb, $3, $4::text[]) as n`, [id, JSON.stringify(chunks), replace, drop]).then((r) => r[0]!.n));
const complete = (id: string, preview: string | null, stats: unknown, next: number | null = null) =>
  asService(db, () => q(db, `select public.knowledge_source_complete($1, $2, $3::jsonb, $4)`, [id, preview, JSON.stringify(stats), next]));
const failure = (id: string, error: string, transient = false, retry = 1800, stats: unknown = null) =>
  asService(db, () => q(db, `select public.knowledge_source_fail($1, $2, $3, $4, $5::jsonb)`, [id, error, transient, retry, stats === null ? null : JSON.stringify(stats)]));
const page = (url: string, text: string, o: { embedding?: number[] | null; title?: string; hash?: string } = {}) => ({
  content: text, embedding: o.embedding === undefined ? [1, 0, 0] : o.embedding, meta: { url, title: o.title ?? 'Page', hash: o.hash ?? `h-${url}` },
});

describe('structure : une fiche de texte reste ce qu’elle était, les autres types ne s’écrivent pas à la main', () => {
  it('une fiche de texte se crée et se modifie comme avant', async () => {
    const { org, member } = await freshOrg();
    const id = await asUser(db, member, async () => (await q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,'Ton','Chaleureux',$2) returning id`, [org, member]))[0]!.id);
    expect(await item(id)).toMatchObject({ kind: 'text', status: 'ready', pinned: true, url: null, file_path: null, attempts: 0, run_at: null });
    await asUser(db, member, () => q(db, `update public.knowledge_items set title = 'Ton de la marque', content = 'Simple', pinned = false where id = $1`, [id]));
    expect(await item(id)).toMatchObject({ title: 'Ton de la marque', pinned: false });
  });

  it('un client ne crée ni fichier, ni site, ni ligne avec un état de lecture, et ne modifie pas cet état', async () => {
    const { org, member } = await freshOrg();
    const insert = (cols: string, vals: string) => asUser(db, member, () => q(db, `insert into public.knowledge_items (org_id, title, content, created_by, ${cols}) values ($1,'X','x',$2, ${vals})`, [org, member]));
    expect(await fail(insert('kind, file_path', `'file', '${org}/a.pdf'`))).toMatch(/permission denied/);
    expect(await fail(insert('kind, url', `'website', 'https://exemple.fr'`))).toMatch(/permission denied/);
    expect(await fail(insert('status', `'pending'`))).toMatch(/permission denied/);
    expect(await fail(insert('attempts', `0`))).toMatch(/permission denied/);
    const id = await addSite(member, org, 'https://exemple.fr');
    for (const set of [`status = 'ready'`, `run_at = null`, `stats = '{}'::jsonb`, `url = 'https://autre.fr'`, `file_path = 'x'`, `kind = 'text'`, `locked_until = null`, `error = 'x'`]) {
      expect(await fail(asUser(db, member, () => q(db, `update public.knowledge_items set ${set} where id = $1`, [id]))), set).toMatch(/permission denied/);
    }
  });

  it('les contraintes de la table, même pour le propriétaire de la base', async () => {
    const { org } = await freshOrg();
    const ins = (cols: string, vals: string) => q(db, `insert into public.knowledge_items (org_id, title, content, ${cols}) values ('${org}', 'T', 'c', ${vals})`);
    expect(await fail(ins('kind', `'autre'`))).toMatch(/check constraint/);
    expect(await fail(ins('kind, status', `'text', 'pending'`))).toMatch(/knowledge_items_text_ready/);
    expect(await fail(ins('kind, file_path', `'file', null`))).toMatch(/knowledge_items_kind_fields/);
    expect(await fail(ins('kind, url', `'website', null`))).toMatch(/knowledge_items_kind_fields/);
    expect(await fail(ins('kind, url, file_path', `'website', 'https://a.fr', '${org}/a.pdf'`))).toMatch(/knowledge_items_kind_fields/);
    expect(await fail(ins('url', `'https://a.fr'`))).toMatch(/knowledge_items_kind_fields/); // un texte n'a pas d'adresse
    expect(await fail(ins('kind, file_path, pinned', `'file', '${org}/a.pdf', true`))).toMatch(/knowledge_items_pinned_text/);
    expect(await fail(ins('kind, file_path', `'file', '00000000-0000-4000-8000-0000000000ff/a.pdf'`))).toMatch(/knowledge_items_file_in_org/);
    expect(await fail(ins('kind, file_path, pinned', `'file', '${org}/../autre/a.pdf', false`))).toMatch(/check constraint/);
    for (const url of ['ftp://a.fr', 'javascript:alert(1)', 'a.fr', 'https://user:pw@a.fr/', 'https://a.fr@evil.fr/', `https://a.fr/${'x'.repeat(2_000)}`]) {
      expect(await fail(ins('kind, url, pinned', `'website', '${url}', false`)), url).toMatch(/check constraint/);
    }
    expect(await fail(ins('kind, file_path, pinned, error', `'file', '${org}/a.pdf', false, 'Pas un code'`))).toMatch(/check constraint/);
    // Un fichier ou un site peut avoir un contenu vide (aperçu pas encore lu) ; une fiche de texte, jamais.
    await ins('kind, file_path, pinned', `'file', '${org}/b.pdf', false`);
    expect(await fail(q(db, `insert into public.knowledge_items (org_id, title, content) values ('${org}', 'T', '   ')`))).toMatch(/knowledge_items_content_check/);
  });

  it('un titre ou un contenu qui change efface les passages d’une fiche de texte, jamais ceux d’un fichier ou d’un site', async () => {
    const { org, member, admin } = await freshOrg();
    const text = await asUser(db, member, async () => (await q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,'Tarifs','Offert',$2) returning id`, [org, member]))[0]!.id);
    await asUser(db, member, () => q(db, `select public.knowledge_replace_chunks($1, $2::jsonb)`, [text, JSON.stringify([{ content: 'Offert', embedding: [1, 0, 0] }])]));
    await asUser(db, member, () => q(db, `update public.knowledge_items set content = 'Autre' where id = $1`, [text]));
    expect(await item(text)).toMatchObject({ chunk_count: 0, indexed_at: null });

    const site = await addSite(admin, org, 'https://exemple.fr');
    await claim();
    await write(site, [page('https://exemple.fr/', 'Livraison')], true);
    await complete(site, 'Aperçu du site', { fetched: 1 });
    await asUser(db, admin, () => q(db, `update public.knowledge_items set title = 'Nouveau nom' where id = $1`, [site]));
    expect(await item(site)).toMatchObject({ title: 'Nouveau nom', chunk_count: 1 });
  });

  it('knowledge_replace_chunks (fiches de texte) refuse un fichier ou un site', async () => {
    const { org, admin } = await freshOrg();
    const site = await addSite(admin, org, 'https://exemple.fr');
    expect(await fail(asUser(db, admin, () => q(db, `select public.knowledge_replace_chunks($1, $2::jsonb)`, [site, JSON.stringify([{ content: 'x' }])])))).toMatch(/knowledge_forbidden/);
  });

  it('pour un fichier ou un site, ni l’état de lecture ni le verrou ne changent la date de mise à jour de la liste ; la fin d’une lecture, si', async () => {
    const { org, admin } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    const stamp = async () => (await item(id)).updated_at.toISOString();
    const first = await stamp();
    await new Promise((r) => setTimeout(r, 15));
    await claim();
    await asService(db, () => q(db, `select public.knowledge_source_touch($1, 60)`, [id]));
    expect(await stamp()).toBe(first);
    await complete(id, 'Un aperçu', {});
    expect(await stamp()).not.toBe(first);
  });
});

describe('knowledge_add_file', () => {
  it('enregistre un fichier déposé dans le dossier de l’organisation : en attente de lecture, jamais épinglé, journalisé', async () => {
    const { org, member } = await freshOrg();
    const p = path(org, 'Catalogue_2026.PDF');
    const id = await addFile(member, org, p, '  Catalogue 2026  ', 2_000_000);
    expect(await item(id)).toMatchObject({
      kind: 'file', status: 'pending', title: 'Catalogue 2026', content: '', pinned: false, file_path: p, mime_type: 'application/pdf', size_bytes: 2_000_000, created_by: member, attempts: 0,
    });
    expect((await item(id)).run_at).not.toBeNull();
    expect(await q(db, `select kind, user_id from public.knowledge_source_log where org_id = $1`, [org])).toEqual([{ kind: 'file', user_id: member }]);
  });

  it('déduit le type MIME de l’extension, pas du navigateur', async () => {
    const { org, member } = await freshOrg();
    const cases: [string, string][] = [['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['b.txt', 'text/plain'], ['c.md', 'text/markdown'], ['d.markdown', 'text/markdown'], ['e.csv', 'text/csv'], ['f.html', 'text/html'], ['g.htm', 'text/html']];
    for (const [name, mime] of cases) expect((await item(await addFile(member, org, path(org, name), name))).mime_type, name).toBe(mime);
  });

  it('refuse les autres rôles, une autre organisation et les visiteurs', async () => {
    const a = await freshOrg();
    const b = await freshOrg();
    expect(await fail(addFile(a.viewer, a.org, path(a.org)))).toMatch(/knowledge_forbidden/);
    expect(await fail(addFile(b.admin, a.org, path(a.org)))).toMatch(/knowledge_forbidden/);
    expect(await fail(asAnon(db, () => q(db, `select public.knowledge_add_file($1, $2, 'x', 10)`, [a.org, path(a.org)])))).toMatch(/permission denied/);
  });

  it('refuse un chemin qui n’est pas directement dans le dossier de l’organisation', async () => {
    const a = await freshOrg();
    const b = await freshOrg();
    for (const p of [path(b.org), `${a.org}/sous/dossier.pdf`, `${a.org}/..%2Fx.pdf`, `${a.org}/a..b.pdf`, `${a.org}/`, a.org, '', `autre/${a.org}/x.pdf`, `${a.org}/${'x'.repeat(320)}.pdf`]) {
      expect(await fail(addFile(a.member, a.org, p)), p.slice(0, 60)).toMatch(/knowledge_invalid_path/);
    }
    expect(await fail(asUser(db, a.member, () => q(db, `select public.knowledge_add_file($1, null, 'x', 10)`, [a.org])))).toMatch(/knowledge_invalid_path/);
  });

  it('refuse un type de fichier non pris en charge, un titre vide, une taille absente ou trop grande', async () => {
    const { org, member } = await freshOrg();
    for (const name of ['a.exe', 'a.doc', 'a.xlsx', 'a.zip', 'sans-extension', 'a.pdf.exe']) expect(await fail(addFile(member, org, path(org, name))), name).toMatch(/knowledge_unsupported_type/);
    expect(await fail(addFile(member, org, path(org), '   '))).toMatch(/knowledge_invalid_title/);
    expect(await fail(addFile(member, org, path(org), 'X', null))).toMatch(/knowledge_file_missing/);
    expect(await fail(addFile(member, org, path(org), 'X', 0))).toMatch(/knowledge_file_missing/);
    expect(await fail(addFile(member, org, path(org), 'X', 10_485_761))).toMatch(/knowledge_file_too_large/);
    expect(await addFile(member, org, path(org, 'limite.pdf'), 'X', 10_485_760)).toBeTruthy();
  });

  it('plafonne : 40 fichiers par organisation, 30 ajouts par jour, 100 sources en tout', async () => {
    const files = await freshOrg();
    await q(db, `insert into public.knowledge_items (org_id, title, content, kind, status, file_path, pinned) select $1::uuid, 'F' || g, '', 'file', 'ready', $1::text || '/f' || g || '.pdf', false from generate_series(1, 40) g`, [files.org]);
    expect(await fail(addFile(files.member, files.org, path(files.org)))).toMatch(/knowledge_files_limit/);

    const daily = await freshOrg();
    await q(db, `insert into public.knowledge_source_log (org_id, kind) select $1, 'file' from generate_series(1, 30)`, [daily.org]);
    expect(await fail(addFile(daily.member, daily.org, path(daily.org)))).toMatch(/knowledge_daily_limit/);
    expect(await fail(addSite(daily.member, daily.org, 'https://exemple.fr'))).toMatch(/knowledge_daily_limit/);
    // Un jour plus tard, le plafond est levé.
    await q(db, `update public.knowledge_source_log set created_at = now() - interval '25 hours' where org_id = $1`, [daily.org]);
    expect(await addFile(daily.member, daily.org, path(daily.org))).toBeTruthy();

    const total = await freshOrg();
    await q(db, `insert into public.knowledge_items (org_id, title, content) select $1, 'T' || g, 'contenu' from generate_series(1, 100) g`, [total.org]);
    expect(await fail(addFile(total.member, total.org, path(total.org)))).toMatch(/knowledge_items_limit/);
  });

  it('supprimer une source ne libère pas le plafond du jour', async () => {
    const { org, member } = await freshOrg();
    await q(db, `insert into public.knowledge_source_log (org_id, kind) select $1, 'website' from generate_series(1, 29)`, [org]);
    const id = await addFile(member, org, path(org));
    await asUser(db, member, () => q(db, `delete from public.knowledge_items where id = $1`, [id]));
    expect(await fail(addFile(member, org, path(org, 'b.pdf')))).toMatch(/knowledge_daily_limit/);
  });
});

describe('knowledge_add_website', () => {
  it('enregistre un site en attente de lecture, avec ses réglages', async () => {
    const { org, member } = await freshOrg();
    const id = await addSite(member, org, '  https://www.exemple.fr/boutique  ', { title: ' Maison Lune ', scope: 'page', auto: false });
    expect(await item(id)).toMatchObject({ kind: 'website', status: 'pending', title: 'Maison Lune', url: 'https://www.exemple.fr/boutique', pinned: false, file_path: null, content: '', config: { scope: 'page', autoSync: false, maxPages: 50 } });
    expect(await item(id).then((i) => i.run_at)).not.toBeNull();
    expect(await q(db, `select kind from public.knowledge_source_log where org_id = $1`, [org])).toEqual([{ kind: 'website' }]);
  });

  it('refuse les adresses qui ne sont pas http(s) ou qui cachent des identifiants', async () => {
    const { org, member } = await freshOrg();
    for (const url of ['ftp://exemple.fr/', 'javascript:alert(1)', 'exemple.fr', 'https://', 'https://user:pw@exemple.fr/', 'https://exemple.fr@evil.example/', 'https://exemple.fr/a b', 'https://exemple.fr/\n', `https://exemple.fr/${'x'.repeat(2_000)}`, '']) {
      expect(await fail(addSite(member, org, url)), JSON.stringify(url).slice(0, 50)).toMatch(/knowledge_invalid_url/);
    }
    expect(await fail(addSite(member, org, 'https://exemple.fr', { scope: 'tout' }))).toMatch(/knowledge_invalid_scope/);
    expect(await fail(addSite(member, org, 'https://exemple.fr', { title: '  ' }))).toMatch(/knowledge_invalid_title/);
  });

  it('refuse un site déjà ajouté (à la casse et au « / » final près), plus de 5 sites, et les mauvais rôles', async () => {
    const a = await freshOrg();
    await addSite(a.member, a.org, 'https://exemple.fr/');
    expect(await fail(addSite(a.member, a.org, 'HTTPS://Exemple.fr'))).toMatch(/knowledge_duplicate/);
    for (let i = 2; i <= 5; i++) await addSite(a.member, a.org, `https://site${i}.fr`);
    expect(await fail(addSite(a.member, a.org, 'https://sixieme.fr'))).toMatch(/knowledge_sites_limit/);
    const b = await freshOrg();
    await addSite(b.member, b.org, 'https://exemple.fr/'); // la même adresse dans une autre organisation est permise
    expect(await fail(addSite(a.viewer, a.org, 'https://autre.fr'))).toMatch(/knowledge_forbidden/);
    expect(await fail(addSite(b.admin, a.org, 'https://autre.fr'))).toMatch(/knowledge_forbidden/);
    expect(await fail(asAnon(db, () => q(db, `select public.knowledge_add_website($1, 'https://a.fr', 'x')`, [a.org])))).toMatch(/permission denied/);
  });
});

describe('knowledge_request_sync (« Actualiser »)', () => {
  it('remet un site prêt ou en échec dans la file, une fois toutes les 10 minutes', async () => {
    const { org, member } = await freshOrg();
    const id = await addSite(member, org, 'https://exemple.fr');
    expect(await asUser(db, member, () => q(db, `select public.knowledge_request_sync($1) as ok`, [id]))).toEqual([{ ok: false }]); // déjà en file
    await claim();
    expect(await asUser(db, member, () => q(db, `select public.knowledge_request_sync($1) as ok`, [id]))).toEqual([{ ok: false }]); // en cours de lecture
    await failure(id, 'http_error');
    expect(await item(id)).toMatchObject({ status: 'failed', error: 'http_error' });

    expect(await asUser(db, member, () => q(db, `select public.knowledge_request_sync($1) as ok`, [id]))).toEqual([{ ok: true }]);
    expect(await item(id)).toMatchObject({ status: 'pending', error: null, attempts: 0 });
    await claim();
    await complete(id, 'Aperçu', {});
    expect(await fail(asUser(db, member, () => q(db, `select public.knowledge_request_sync($1)`, [id])))).toMatch(/knowledge_sync_too_soon/);
    await q(db, `update public.knowledge_items set requested_at = now() - interval '11 minutes' where id = $1`, [id]);
    expect(await asUser(db, member, () => q(db, `select public.knowledge_request_sync($1) as ok`, [id]))).toEqual([{ ok: true }]);
  });

  it('refuse une fiche de texte, un lecteur, un étranger et une fiche inexistante', async () => {
    const a = await freshOrg();
    const b = await freshOrg();
    const site = await addSite(a.member, a.org, 'https://exemple.fr');
    const text = await asUser(db, a.member, async () => (await q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,'T','c',$2) returning id`, [a.org, a.member]))[0]!.id);
    for (const [user, id] of [[a.member, text], [a.viewer, site], [b.admin, site], [a.member, '00000000-0000-4000-8000-0000000000aa']] as const) {
      expect(await fail(asUser(db, user, () => q(db, `select public.knowledge_request_sync($1)`, [id])))).toMatch(/knowledge_forbidden/);
    }
  });
});

describe('claim_knowledge_sources : le worker réclame les sources à lire', () => {
  it('seul le worker (service_role) peut l’appeler, comme les autres fonctions d’écriture', async () => {
    const { org, admin } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    const forbidden = (sql: string, params: unknown[]) => fail(asUser(db, admin, () => q(db, sql, params)));
    expect(await forbidden(`select * from public.claim_knowledge_sources(1, 60)`, [])).toMatch(/permission denied/);
    expect(await forbidden(`select public.knowledge_source_touch($1, 60)`, [id])).toMatch(/permission denied/);
    expect(await forbidden(`select public.knowledge_source_write($1, '[]'::jsonb, false, '{}')`, [id])).toMatch(/permission denied/);
    expect(await forbidden(`select public.knowledge_source_complete($1, 'x', '{}'::jsonb, null)`, [id])).toMatch(/permission denied/);
    expect(await forbidden(`select public.knowledge_source_fail($1, 'internal', false, 60, null)`, [id])).toMatch(/permission denied/);
    expect(await fail(asAnon(db, () => q(db, `select * from public.claim_knowledge_sources(1, 60)`)))).toMatch(/permission denied/);
  });

  it('réclame une source en attente : en cours de lecture, verrouillée 3 minutes, un essai de plus ; une seconde demande ne la reprend pas', async () => {
    await claim(50); // vide la file des tests précédents
    const { org, admin } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    const [job, ...rest] = await claim(5);
    expect(rest).toEqual([]);
    expect(job).toMatchObject({ id, org_id: org, kind: 'website', title: 'Mon site', url: 'https://exemple.fr', file_path: null, attempts: 1, chunk_count: 0, config: { scope: 'site', autoSync: true, maxPages: 50 } });
    const row = await item(id);
    expect(row.status).toBe('processing');
    const left = (new Date(row.locked_until).getTime() - Date.now()) / 1000;
    expect(left).toBeGreaterThan(170);
    expect(left).toBeLessThanOrEqual(181);
    expect(await claim(5)).toEqual([]);
  });

  it('respecte la limite, l’ordre d’arrivée, les échéances futures, les fiches de texte et les sources déjà prêtes', async () => {
    await claim(50);
    const { org, admin, member } = await freshOrg();
    const first = await addFile(member, org, path(org, 'un.pdf'));
    const second = await addFile(member, org, path(org, 'deux.pdf'));
    const later = await addSite(admin, org, 'https://plus-tard.fr');
    await q(db, `update public.knowledge_items set run_at = now() + interval '1 hour' where id = $1`, [later]);
    await q(db, `update public.knowledge_items set run_at = now() - interval '2 minutes' where id = $1`, [first]);
    await q(db, `update public.knowledge_items set run_at = now() - interval '1 minute' where id = $1`, [second]);
    await asUser(db, member, () => q(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,'Un texte','c',$2)`, [org, member]));
    const ready = await addSite(admin, org, 'https://prete.fr');
    await q(db, `update public.knowledge_items set status = 'ready', run_at = null where id = $1`, [ready]);

    expect((await claim(1)).map((j) => j.id)).toEqual([first]);
    expect((await claim(10)).map((j) => j.id)).toEqual([second]);
    expect(await claim(10)).toEqual([]);
  });

  it('relit chaque semaine un site prêt dont l’échéance est venue', async () => {
    await claim(50);
    const { org, admin } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    await claim();
    await write(id, [page('https://exemple.fr/', 'Livraison offerte')], true);
    await complete(id, 'Aperçu', { fetched: 1 }, 7 * 86_400);
    expect(await item(id)).toMatchObject({ status: 'ready', error: null, attempts: 0 });
    expect(await claim()).toEqual([]);
    await q(db, `update public.knowledge_items set run_at = now() - interval '1 minute' where id = $1`, [id]);
    const [job] = await claim();
    expect(job).toMatchObject({ id, chunk_count: 1, attempts: 1 });
  });

  it('reprend une lecture abandonnée (verrou expiré) jusqu’à trois fois, puis la déclare en échec', async () => {
    await claim(50);
    const { org, admin } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    const expire = () => q(db, `update public.knowledge_items set locked_until = now() - interval '1 second' where id = $1`, [id]);
    expect((await claim())[0]).toMatchObject({ id, attempts: 1 });
    expect(await claim()).toEqual([]); // le verrou tient
    await expire();
    expect((await claim())[0]).toMatchObject({ id, attempts: 2 });
    await expire();
    expect((await claim())[0]).toMatchObject({ id, attempts: 3 });
    await expire();
    expect(await claim()).toEqual([]);
    expect(await item(id)).toMatchObject({ status: 'failed', error: 'timeout', locked_until: null });
  });

  it('une source abandonnée qui avait déjà des passages reste utilisable (prête, avec l’erreur), et un site garde sa relecture', async () => {
    await claim(50);
    const { org, admin } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    await claim();
    await write(id, [page('https://exemple.fr/', 'Livraison offerte')], true);
    await q(db, `update public.knowledge_items set attempts = 3, locked_until = now() - interval '1 second' where id = $1`, [id]);
    expect(await claim()).toEqual([]);
    const row = await item(id);
    expect(row).toMatchObject({ status: 'ready', error: 'timeout', chunk_count: 1 });
    expect(new Date(row.run_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it('knowledge_source_touch prolonge le verrou d’une lecture en cours, et seulement elle', async () => {
    await claim(50);
    const { org, admin } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    await asService(db, () => q(db, `select public.knowledge_source_touch($1, 600)`, [id]));
    expect((await item(id)).locked_until).toBeNull(); // pas en cours de lecture : rien
    await claim();
    await asService(db, () => q(db, `select public.knowledge_source_touch($1, 600)`, [id]));
    expect((new Date((await item(id)).locked_until).getTime() - Date.now()) / 1000).toBeGreaterThan(590);
  });
});

describe('knowledge_source_write : les passages d’un fichier ou d’un site', () => {
  async function source(kind: 'file' | 'website' = 'website') {
    const o = await freshOrg();
    const id = kind === 'file' ? await addFile(o.member, o.org, path(o.org)) : await addSite(o.admin, o.org, 'https://exemple.fr');
    return { ...o, id };
  }

  it('remplace tous les passages (fichier) et tient les compteurs : nombre, indexation, passages vectorisés', async () => {
    const { id } = await source('file');
    expect(await write(id, [{ content: 'a', embedding: [1, 0, 0], meta: { pages: [1, 2] } }, { content: 'b', embedding: [0, 1, 0] }], true)).toBe(2);
    expect(await item(id)).toMatchObject({ chunk_count: 2 });
    expect((await item(id)).embedded_at).not.toBeNull();
    expect((await item(id)).indexed_at).not.toBeNull();
    expect(await write(id, [{ content: 'c', embedding: null }, { content: 'd', embedding: [1, 0, 0] }, { content: 'e' }], true)).toBe(3);
    expect(await q(db, `select ord, content from public.knowledge_chunks where item_id = $1 order by ord`, [id])).toEqual([{ ord: 0, content: 'c' }, { ord: 1, content: 'd' }, { ord: 2, content: 'e' }]);
    expect((await item(id)).embedded_at).toBeNull(); // des passages sans vecteur
    expect(await q(db, `select meta from public.knowledge_chunks where item_id = $1 and content = 'a'`, [id])).toEqual([]);
  });

  it('un site : retire les passages des pages demandées et ajoute les nouveaux à la suite, sans toucher aux autres pages', async () => {
    const { id } = await source();
    await write(id, [page('https://exemple.fr/', 'accueil'), page('https://exemple.fr/a', 'page a'), page('https://exemple.fr/b', 'page b premier'), page('https://exemple.fr/b', 'page b second')], false);
    expect(await write(id, [page('https://exemple.fr/b', 'page b nouveau')], false, ['https://exemple.fr/b'])).toBe(3);
    const rows = await q<{ ord: number; content: string }>(db, `select ord, content from public.knowledge_chunks where item_id = $1 order by ord`, [id]);
    expect(rows.map((r) => r.content)).toEqual(['accueil', 'page a', 'page b nouveau']);
    expect(rows.map((r) => r.ord)).toEqual([0, 1, 2]); // les nouveaux passages se placent après le dernier
    expect(await write(id, [], false, ['https://exemple.fr/a'])).toBe(2); // une page retirée, rien d'ajouté
    expect((await item(id)).chunk_count).toBe(2);
  });

  it('sans pages demandées ni remplacement, ajoute seulement', async () => {
    const { id } = await source();
    await write(id, [page('https://exemple.fr/', 'accueil')]);
    expect(await write(id, [page('https://exemple.fr/a', 'a')])).toBe(2);
  });

  it('plafonne : 400 passages par source, 3 000 par organisation', async () => {
    const { id, org, admin } = await source();
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ content: `passage ${i}`, embedding: null }));
    expect(await write(id, many(400), true)).toBe(400);
    expect(await fail(write(id, many(1)))).toMatch(/knowledge_item_chunks_limit/);
    expect(await write(id, many(400), true)).toBe(400); // remplacer par un lot aussi grand reste permis
    // 2 600 passages d'une autre source de l'organisation : avec les 400 ci-dessus, l'organisation est à 3 000.
    const other = await addSite(admin, org, 'https://autre.fr');
    await q(db, `insert into public.knowledge_chunks (org_id, item_id, ord, content) select $1, $2, g, 'x' from generate_series(0, 2599) g`, [org, other]);
    const third = await addSite(admin, org, 'https://troisieme.fr');
    expect(await fail(write(third, many(1)))).toMatch(/knowledge_chunks_limit/);
    // Une fois la place libérée, l'écriture passe.
    await q(db, `delete from public.knowledge_chunks where item_id = $1 and ord < 10`, [other]);
    expect(await write(third, many(10))).toBe(10);
  });

  it('refuse une fiche de texte, une source inexistante et un paquet qui n’est pas un tableau', async () => {
    const { id, org, member } = await source();
    const text = await asUser(db, member, async () => (await q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,'T','c',$2) returning id`, [org, member]))[0]!.id);
    expect(await fail(write(text, [], true))).toMatch(/knowledge_forbidden/);
    expect(await fail(write('00000000-0000-4000-8000-0000000000ab', [], true))).toMatch(/knowledge_forbidden/);
    expect(await fail(asService(db, () => q(db, `select public.knowledge_source_write($1, '{"a":1}'::jsonb, true, '{}')`, [id])))).toMatch(/doit être un tableau/);
  });
});

describe('knowledge_source_complete et knowledge_source_fail', () => {
  it('complete : prête, aperçu court, chiffres, date de lecture, prochaine relecture ; ne touche pas une fiche de texte', async () => {
    const { org, admin, member } = await freshOrg();
    const id = await addSite(admin, org, 'https://exemple.fr');
    await claim();
    await complete(id, 'x'.repeat(2_500), { fetched: 3, chunks: 7, embedded: true }, 3_600);
    const row = await item(id);
    expect(row).toMatchObject({ status: 'ready', error: null, attempts: 0, locked_until: null, stats: { fetched: 3, chunks: 7, embedded: true } });
    expect(row.content).toHaveLength(2_000);
    expect(row.synced_at).not.toBeNull();
    expect(new Date(row.run_at).getTime() - Date.now()).toBeGreaterThan(3_500_000);
    await complete(id, null, { fetched: 1 });
    expect(await item(id)).toMatchObject({ content: row.content, run_at: null, stats: { fetched: 1 } }); // pas d'aperçu : l'ancien reste

    const text = await asUser(db, member, async () => (await q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,'T','contenu',$2) returning id`, [org, member]))[0]!.id);
    await complete(text, 'autre', { x: 1 });
    expect(await item(text)).toMatchObject({ content: 'contenu', synced_at: null, stats: {} });
  });

  it('fail passagère : retour en file avec un délai, trois essais, puis abandon', async () => {
    await claim(50);
    const { org, member } = await freshOrg();
    const id = await addFile(member, org, path(org));
    await claim();
    await failure(id, 'timeout', true, 600, { fetched: 0 });
    let row = await item(id);
    expect(row).toMatchObject({ status: 'pending', error: 'timeout', locked_until: null, attempts: 1, stats: { fetched: 0 } });
    expect(new Date(row.run_at).getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(await claim()).toEqual([]); // l'échéance n'est pas venue
    await q(db, `update public.knowledge_items set run_at = now() where id = $1`, [id]);
    await claim();
    await failure(id, 'timeout', true, 60);
    await q(db, `update public.knowledge_items set run_at = now() where id = $1`, [id]);
    await claim(); // troisième essai
    await failure(id, 'timeout', true, 60);
    row = await item(id);
    expect(row).toMatchObject({ status: 'failed', error: 'timeout', attempts: 0, run_at: null });
  });

  it('fail définitive : « failed » sans passages, « ready » avec l’erreur quand la source en gardait ; le site garde sa relecture hebdomadaire seulement s’il l’avait demandée', async () => {
    await claim(50);
    const { org, admin, member } = await freshOrg();
    const empty = await addFile(member, org, path(org));
    await claim();
    await failure(empty, 'no_text');
    expect(await item(empty)).toMatchObject({ status: 'failed', error: 'no_text', run_at: null });

    const kept = await addSite(admin, org, 'https://exemple.fr');
    await claim();
    await write(kept, [page('https://exemple.fr/', 'Livraison')], true);
    await failure(kept, 'robots_disallowed');
    const row = await item(kept);
    expect(row).toMatchObject({ status: 'ready', error: 'robots_disallowed', chunk_count: 1 });
    expect(new Date(row.run_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const manual = await addSite(admin, org, 'https://manuel.fr', { auto: false });
    await claim();
    await write(manual, [page('https://manuel.fr/', 'Livraison')], true);
    await failure(manual, 'http_error');
    expect(await item(manual)).toMatchObject({ status: 'ready', run_at: null });
  });

  it('un code d’erreur qui n’en est pas un devient « internal » ; une fiche de texte n’est jamais touchée', async () => {
    await claim(50);
    const { org, member } = await freshOrg();
    const id = await addFile(member, org, path(org));
    await claim();
    await failure(id, 'Exception: connexion refusée à 10.0.0.5');
    expect((await item(id)).error).toBe('internal');
    const text = await asUser(db, member, async () => (await q<{ id: string }>(db, `insert into public.knowledge_items (org_id, title, content, created_by) values ($1,'T','c',$2) returning id`, [org, member]))[0]!.id);
    await failure(text, 'internal');
    expect(await item(text)).toMatchObject({ status: 'ready', error: null });
  });
});

describe('knowledge_source_pages et recherche', () => {
  it('liste les pages d’un site : adresse, titre, empreinte, passages et passages vectorisés (sous la RLS)', async () => {
    const a = await freshOrg();
    const b = await freshOrg();
    const id = await addSite(a.admin, a.org, 'https://exemple.fr');
    await claim(50);
    await write(id, [
      page('https://exemple.fr/', 'accueil', { title: 'Accueil', hash: 'h1' }),
      page('https://exemple.fr/livraison', 'livraison un', { title: 'Livraison', hash: 'h2' }),
      page('https://exemple.fr/livraison', 'livraison deux', { title: 'Livraison', hash: 'h2', embedding: null }),
      { content: 'sans adresse', embedding: [1, 0, 0] },
    ], true);
    const pages = (user: string) => asUser(db, user, () => q(db, `select * from public.knowledge_source_pages($1)`, [id]));
    expect(await pages(a.viewer)).toEqual([
      { url: 'https://exemple.fr/', title: 'Accueil', hash: 'h1', chunks: 1, embedded: 1 },
      { url: 'https://exemple.fr/livraison', title: 'Livraison', hash: 'h2', chunks: 2, embedded: 1 },
    ]);
    expect(await pages(b.admin)).toEqual([]);
    expect(await asService(db, () => q(db, `select * from public.knowledge_source_pages($1)`, [id])).then((r) => r.length)).toBe(2);
  });

  it('les passages d’un site se retrouvent par la recherche, avec l’adresse et le titre de leur page', async () => {
    const a = await freshOrg();
    const id = await addSite(a.admin, a.org, 'https://exemple.fr', { title: 'Maison Lune' });
    await claim(50);
    await write(id, [page('https://exemple.fr/livraison', 'La livraison en Belgique prend sept jours.', { title: 'Livraison et retours', embedding: null })], true);
    const hits = await asUser(db, a.member, () => q<{ title: string; content: string; meta: Record<string, string> }>(db, `select * from public.knowledge_search($1, null, $2::text[])`, [a.org, ['livraison', 'belgique']]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Maison Lune', meta: { url: 'https://exemple.fr/livraison', title: 'Livraison et retours' } });
  });

  it('supprimer la source supprime ses passages', async () => {
    const a = await freshOrg();
    const id = await addSite(a.admin, a.org, 'https://exemple.fr');
    await claim(50);
    await write(id, [page('https://exemple.fr/', 'accueil')], true);
    await asUser(db, a.admin, () => q(db, `delete from public.knowledge_items where id = $1`, [id]));
    expect(await q(db, `select 1 from public.knowledge_chunks where item_id = $1`, [id])).toEqual([]);
  });
});
