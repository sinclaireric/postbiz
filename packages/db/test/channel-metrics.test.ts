import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;
let fb: string; // une Page Facebook de l'org A
let tt: string; // un canal TikTok de l'org A

const PROVIDERS = ['facebook', 'instagram', 'tiktok'];
const claim = (limit = 10) =>
  asService(db, () => q<{ id: string; attempts: number; backfilled: boolean; provider: string }>(db, `select * from public.claim_metrics_sync($1::public.social_provider[], $2, 600)`, [`{${PROVIDERS.join(',')}}`, limit]));
const record = (integration: string, rows: unknown) => asService(db, () => q<{ n: number }>(db, `select public.record_channel_metrics($1, $2::jsonb) as n`, [integration, JSON.stringify(rows)]).then((r) => r[0]!.n));
const sync = (integration: string) => q<Record<string, any>>(db, `select * from public.channel_metrics_sync where integration_id = $1`, [integration]).then((r) => r[0]);

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
  const add = async (org: string, provider: string, internal: string) => {
    const id = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1, $2::public.social_provider, $3, $3) returning id`, [org, provider, internal]))[0]!.id;
    await q(db, `insert into public.integration_secrets (integration_id, access_token_enc) values ($1, 'ENC')`, [id]);
    return id;
  };
  fb = await add(w.orgA, 'facebook', 'page-a');
  tt = await add(w.orgA, 'tiktok', 'tt-a');
  for (const id of [w.intA, w.intB]) await q(db, `insert into public.integration_secrets (integration_id, access_token_enc) values ($1, 'ENC')`, [id]);
});

describe('relevés quotidiens : enregistrement', () => {
  it('enregistre des relevés pour le canal, avec l’organisation du canal', async () => {
    const n = await record(fb, [
      { day: '2026-10-23', metric: 'reach', value: 1200 },
      { day: '2026-10-23', metric: 'engagement', value: 88.4 },
      { day: '2026-10-24', metric: 'followers', value: 5130 },
    ]);
    expect(n).toBe(3);
    const rows = await q<{ org_id: string; day: string; metric: string; value: string }>(db, `select org_id, day::text, metric, value::text from public.channel_metrics_daily where integration_id = $1 order by day, metric`, [fb]);
    expect(rows).toEqual([
      { org_id: w.orgA, day: '2026-10-23', metric: 'engagement', value: '88' },
      { org_id: w.orgA, day: '2026-10-23', metric: 'reach', value: '1200' },
      { org_id: w.orgA, day: '2026-10-24', metric: 'followers', value: '5130' },
    ]);
  });

  it('un relevé du même jour est remplacé (le jour en cours se corrige)', async () => {
    await record(fb, [{ day: '2026-10-24', metric: 'followers', value: 5140 }]);
    const rows = await q<{ value: string }>(db, `select value::text from public.channel_metrics_daily where integration_id = $1 and day = '2026-10-24' and metric = 'followers'`, [fb]);
    expect(rows).toEqual([{ value: '5140' }]);
  });

  it('ignore les lignes invalides sans faire échouer les autres', async () => {
    const n = await record(fb, [
      { day: '2026-10-22', metric: 'reach', value: -5 }, // négatif
      { day: null, metric: 'reach', value: 5 },
      { day: '2026-10-22', metric: 'reach', value: null },
      { day: '2026-10-22', metric: 'engagement', value: 7 },
    ]);
    expect(n).toBe(1);
  });

  it('refuse une métrique inconnue et un paramètre qui n’est pas une liste', async () => {
    await expect(record(fb, [{ day: '2026-10-22', metric: 'revenue', value: 1 }])).rejects.toThrow();
    await expect(record(fb, { day: '2026-10-22' })).rejects.toThrow(/invalides/);
  });

  it('refuse plus de 2000 relevés d’un coup', async () => {
    const many = Array.from({ length: 2001 }, () => ({ day: '2026-10-22', metric: 'reach', value: 1 }));
    await expect(record(fb, many)).rejects.toThrow(/invalides/);
  });

  it('ne rattache jamais un relevé à une autre organisation et ignore un canal supprimé', async () => {
    const gone = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name, deleted_at) values ($1, 'facebook', 'gone', 'Supprimé', now()) returning id`, [w.orgA]))[0]!.id;
    expect(await record(gone, [{ day: '2026-10-22', metric: 'reach', value: 1 }])).toBe(0);
    expect(await record('00000000-0000-0000-0000-000000000000', [{ day: '2026-10-22', metric: 'reach', value: 1 }])).toBe(0);
  });
});

describe('relevés quotidiens : accès', () => {
  it('un membre de l’organisation lit ses relevés, y compris un lecteur', async () => {
    for (const user of [w.alice, w.carol, w.dave]) {
      const rows = await asUser(db, user, () => q(db, `select * from public.channel_metrics_daily where integration_id = $1`, [fb]));
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it('une autre organisation ne voit rien, un anonyme non plus', async () => {
    expect(await asUser(db, w.bob, () => q(db, `select * from public.channel_metrics_daily`))).toEqual([]);
    await expect(asAnon(db, () => q(db, `select * from public.channel_metrics_daily`))).rejects.toThrow();
  });

  it('aucun client n’écrit : ni insertion, ni modification, ni suppression', async () => {
    await expect(asUser(db, w.alice, () => q(db, `insert into public.channel_metrics_daily (integration_id, org_id, day, metric, value) values ($1, $2, '2026-10-01', 'reach', 1)`, [fb, w.orgA]))).rejects.toThrow();
    await expect(asUser(db, w.alice, () => q(db, `update public.channel_metrics_daily set value = 0`))).rejects.toThrow();
    await expect(asUser(db, w.alice, () => q(db, `delete from public.channel_metrics_daily`))).rejects.toThrow();
  });

  it('les fonctions de collecte ne sont exécutables que par le worker', async () => {
    for (const sql of [
      `select public.record_channel_metrics('${fb}', '[]'::jsonb)`,
      `select * from public.claim_metrics_sync(array['facebook']::public.social_provider[], 1, 60)`,
      `select public.complete_metrics_sync('${fb}', 60, true)`,
      `select public.fail_metrics_sync('${fb}', 'error', 'x', 60)`,
    ]) {
      await expect(asUser(db, w.alice, () => q(db, sql))).rejects.toThrow(/permission denied/);
      await expect(asAnon(db, () => q(db, sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('supprimer un canal supprime ses relevés', async () => {
    const id = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1, 'facebook', 'tmp', 'Tmp') returning id`, [w.orgA]))[0]!.id;
    await record(id, [{ day: '2026-10-20', metric: 'reach', value: 3 }]);
    await q(db, `delete from public.integrations where id = $1`, [id]);
    expect(await q(db, `select 1 from public.channel_metrics_daily where integration_id = $1`, [id])).toEqual([]);
  });
});

describe('suivi de la collecte', () => {
  it('réclame les canaux actifs des réseaux demandés, avec une ligne de suivi créée au passage', async () => {
    const got = await claim();
    const ids = got.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining([fb, tt, w.intA, w.intB]));
    expect(got.every((g) => PROVIDERS.includes(g.provider))).toBe(true);
    expect(got.find((g) => g.id === fb)).toMatchObject({ attempts: 0, backfilled: false });
    expect(await sync(fb)).toMatchObject({ status: 'pending' });
  });

  it('un canal verrouillé n’est pas réclamé une seconde fois', async () => {
    expect(await claim()).toEqual([]);
  });

  it('ne réclame ni un réseau non demandé, ni un canal sans jeton, ni un canal à reconnecter', async () => {
    const li = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1, 'linkedin', 'li', 'LI') returning id`, [w.orgA]))[0]!.id;
    await q(db, `insert into public.integration_secrets (integration_id, access_token_enc) values ($1, 'ENC')`, [li]);
    const nosecret = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1, 'facebook', 'nos', 'Sans jeton') returning id`, [w.orgA]))[0]!.id;
    const stale = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name, status) values ($1, 'facebook', 'old', 'Ancien', 'refresh_needed') returning id`, [w.orgA]))[0]!.id;
    await q(db, `insert into public.integration_secrets (integration_id, access_token_enc) values ($1, 'ENC')`, [stale]);
    const got = (await claim()).map((g) => g.id);
    expect(got).not.toContain(li);
    expect(got).not.toContain(nosecret);
    expect(got).not.toContain(stale);
  });

  it('une collecte réussie programme la suivante et garde la trace du premier passage', async () => {
    await asService(db, () => q(db, `select public.complete_metrics_sync($1, 21600, true)`, [fb]));
    const s = (await sync(fb))!;
    expect(s).toMatchObject({ status: 'ok', attempts: 0, error: null, locked_until: null });
    expect(s.backfilled_at).not.toBeNull();
    expect(s.last_success_at).not.toBeNull();
    const [{ hours }] = await q<{ hours: number }>(db, `select extract(epoch from (next_attempt_at - now())) / 3600 as hours from public.channel_metrics_sync where integration_id = $1`, [fb]);
    expect(Number(hours)).toBeGreaterThan(5.9);
    expect(Number(hours)).toBeLessThan(6.1);
    // pas encore due : n'est pas réclamée
    expect((await claim()).map((g) => g.id)).not.toContain(fb);
  });

  it('un échec garde le statut, le message court et compte les tentatives', async () => {
    await asService(db, () => q(db, `select public.fail_metrics_sync($1, 'missing_scope', $2, 60)`, [tt, 'x'.repeat(500)]));
    expect(await sync(tt)).toMatchObject({ status: 'missing_scope', attempts: 1 });
    expect(((await sync(tt))!.error as string).length).toBe(300);
    await asService(db, () => q(db, `select public.fail_metrics_sync($1, 'error', 'réseau', 60)`, [tt]));
    expect(await sync(tt)).toMatchObject({ status: 'error', attempts: 2, error: 'réseau' });
  });

  it('refuse un statut inconnu', async () => {
    await expect(asService(db, () => q(db, `select public.fail_metrics_sync($1, 'ok', 'x', 60)`, [tt]))).rejects.toThrow(/statut inconnu/);
  });

  it('un canal dont l’échéance est passée est réclamé de nouveau, avec son nombre de tentatives et son passage initial', async () => {
    await q(db, `update public.channel_metrics_sync set next_attempt_at = now() - interval '1 minute', locked_until = null where integration_id = any ($1::uuid[])`, [[fb, tt]]);
    const got = await claim();
    expect(got.find((g) => g.id === fb)).toMatchObject({ backfilled: true, attempts: 0 });
    expect(got.find((g) => g.id === tt)).toMatchObject({ backfilled: false, attempts: 2 });
  });

  it('un membre lit l’état de collecte de ses canaux, pas celui d’une autre organisation', async () => {
    const mine = await asUser(db, w.carol, () => q<{ integration_id: string }>(db, `select integration_id from public.channel_metrics_sync`));
    expect(mine.map((r) => r.integration_id)).toEqual(expect.arrayContaining([fb, tt]));
    expect(mine.map((r) => r.integration_id)).not.toContain(w.intB);
    await expect(asUser(db, w.alice, () => q(db, `update public.channel_metrics_sync set status = 'ok'`))).rejects.toThrow();
  });

  it('une ligne de suivi disparaît avec son canal', async () => {
    const id = (await q<{ id: string }>(db, `insert into public.integrations (org_id, provider, internal_id, name) values ($1, 'facebook', 'bye', 'Bye') returning id`, [w.orgA]))[0]!.id;
    await q(db, `insert into public.integration_secrets (integration_id, access_token_enc) values ($1, 'ENC')`, [id]);
    await claim();
    expect(await sync(id)).toBeDefined();
    await q(db, `delete from public.integrations where id = $1`, [id]);
    expect(await sync(id)).toBeUndefined();
  });
});
