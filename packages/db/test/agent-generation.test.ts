import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const reserve = (user: string, org: string, kind: string, limit: number) =>
  asUser(db, user, () => q<{ ok: boolean }>(db, `select public.ai_generation_reserve($1, $2, $3) as ok`, [org, kind, limit]).then((r) => r[0]!.ok));

const media = (org: string, user: string) =>
  q<{ id: string }>(db, `insert into public.media (org_id, path, mime_type, created_by, name) values ($1, $2, 'video/mp4', $3, 'ai-video.mp4') returning id`, [org, `${org}/${Math.random().toString(16).slice(2)}-ai-video.mp4`, user]).then((r) => r[0]!.id);

const job = (org: string, user: string, task = 'task-1', over: Record<string, unknown> = {}) =>
  q<{ id: string }>(db,
    `insert into public.ai_video_jobs (org_id, created_by, prompt, orientation, provider_task_id, reference_media_ids) values ($1,$2,$3,$4,$5,$6::jsonb) returning id`,
    [org, user, over.prompt ?? 'Un atelier de menuiserie au lever du jour', over.orientation ?? 'vertical', task, JSON.stringify(over.references ?? [])]);

describe('génération : plafond par organisation et par jour', () => {
  it('réserve jusqu’au plafond, puis refuse', async () => {
    expect(await reserve(w.alice, w.orgA, 'image', 2)).toBe(true);
    expect(await reserve(w.carol, w.orgA, 'image', 2)).toBe(true);
    expect(await reserve(w.alice, w.orgA, 'image', 2)).toBe(false);
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.ai_generations where org_id = $1 and kind = 'image'`, [w.orgA]))[0]!.n).toBe(2);
  });

  it('le plafond se compte par organisation et par type', async () => {
    expect(await reserve(w.alice, w.orgA, 'video', 1)).toBe(true);
    expect(await reserve(w.carol, w.orgA, 'video', 1)).toBe(false);
    expect(await reserve(w.bob, w.orgB, 'image', 1)).toBe(true);
    expect(await reserve(w.bob, w.orgB, 'video', 1)).toBe(true);
  });

  it('un plafond à zéro désactive la génération', async () => {
    expect(await reserve(w.bob, w.orgB, 'image', 0)).toBe(false);
  });

  it('seules les générations des dernières 24 heures comptent', async () => {
    await q(db, `insert into public.ai_generations (org_id, user_id, kind, created_at) values ($1, $2, 'image', now() - interval '25 hours'), ($1, $2, 'image', now() - interval '30 hours')`, [w.orgB, w.bob]);
    // Une seule génération récente chez B (celle du test précédent) : un plafond de 2 laisse passer, celui de 1 non.
    expect(await reserve(w.bob, w.orgB, 'image', 1)).toBe(false);
    expect(await reserve(w.bob, w.orgB, 'image', 2)).toBe(true);
  });

  it('un lecteur, un étranger à l’organisation ou un visiteur ne réservent rien', async () => {
    expect(await reserve(w.dave, w.orgA, 'image', 100)).toBe(false);
    expect(await reserve(w.bob, w.orgA, 'image', 100)).toBe(false);
    await expect(asAnon(db, () => q(db, `select public.ai_generation_reserve($1, 'image', 10)`, [w.orgA]))).rejects.toThrow(/permission denied/);
  });

  it('refuse un type ou un plafond invalide', async () => {
    await expect(reserve(w.alice, w.orgA, 'audio', 1)).rejects.toThrow(/invalides/);
    await expect(reserve(w.alice, w.orgA, 'image', -1)).rejects.toThrow(/invalides/);
  });

  it('le journal est en ajout seul : on ne l’efface ni ne le corrige, et on n’écrit pas pour un autre', async () => {
    await expect(asUser(db, w.alice, () => q(db, `delete from public.ai_generations where org_id = $1`, [w.orgA]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `update public.ai_generations set created_at = now() - interval '3 days'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.alice, () => q(db, `insert into public.ai_generations (org_id, user_id, kind) values ($1, $2, 'image')`, [w.orgA, w.carol]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.bob, () => q(db, `insert into public.ai_generations (org_id, user_id, kind) values ($1, $2, 'image')`, [w.orgA, w.bob]))).rejects.toThrow(/row-level security/);
  });

  it('supprimer une image générée n’efface pas son coût du journal', async () => {
    const before = (await q<{ n: number }>(db, `select count(*)::int as n from public.ai_generations where org_id = $1`, [w.orgA]))[0]!.n;
    const id = await media(w.orgA, w.alice);
    await asUser(db, w.alice, () => q(db, `delete from public.media where id = $1`, [id]));
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.ai_generations where org_id = $1`, [w.orgA]))[0]!.n).toBe(before);
  });
});

describe('tâches de génération vidéo', () => {
  it('une tâche est privée à son auteur', async () => {
    const mine = (await asUser(db, w.alice, () => job(w.orgA, w.alice, 'alice-task')))[0]!.id;
    const theirs = (await asUser(db, w.carol, () => job(w.orgA, w.carol, 'carol-task')))[0]!.id;
    const seen = (user: string) => asUser(db, user, () => q<{ id: string }>(db, 'select id from public.ai_video_jobs'));
    expect((await seen(w.alice)).map((r) => r.id)).toEqual([mine]);
    expect((await seen(w.carol)).map((r) => r.id)).toEqual([theirs]);
    expect(await seen(w.bob)).toEqual([]);
    expect(await seen(w.dave)).toEqual([]);
  });

  it('on n’ouvre pas de tâche pour un autre, chez une autre organisation, ni comme lecteur ou visiteur', async () => {
    await expect(asUser(db, w.alice, () => job(w.orgA, w.carol))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.bob, () => job(w.orgA, w.bob))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, w.dave, () => job(w.orgA, w.dave))).rejects.toThrow(/row-level security/);
    await expect(asAnon(db, () => q(db, 'select * from public.ai_video_jobs'))).rejects.toThrow(/permission denied/);
  });

  it('refuse un texte vide, une orientation inconnue et plus de trois images de référence', async () => {
    await expect(asUser(db, w.bob, () => job(w.orgB, w.bob, 'b1', { prompt: '' }))).rejects.toThrow(/check/);
    await expect(asUser(db, w.bob, () => job(w.orgB, w.bob, 'b2', { orientation: 'carre' }))).rejects.toThrow(/check/);
    await expect(asUser(db, w.bob, () => job(w.orgB, w.bob, 'b3', { references: ['a', 'b', 'c', 'd'] }))).rejects.toThrow(/check/);
  });

  it('plafonne à trois vidéos en cours par personne', async () => {
    await asUser(db, w.bob, () => job(w.orgB, w.bob, 'b-1'));
    await asUser(db, w.bob, () => job(w.orgB, w.bob, 'b-2'));
    await asUser(db, w.bob, () => job(w.orgB, w.bob, 'b-3'));
    await expect(asUser(db, w.bob, () => job(w.orgB, w.bob, 'b-4'))).rejects.toThrow(/ai_video_jobs_limit/);
    // Une tâche terminée libère une place.
    await asUser(db, w.bob, () => q(db, `update public.ai_video_jobs set status = 'failed', error = 'Délai dépassé' where provider_task_id = 'b-1'`));
    await asUser(db, w.bob, () => job(w.orgB, w.bob, 'b-4'));
  });

  it('son auteur la fait avancer (état, erreur, média) mais ne change ni son texte ni son identifiant chez le fournisseur', async () => {
    const id = (await asUser(db, w.carol, () => job(w.orgA, w.carol, 'carol-task-2')))[0]!.id;
    const claimed = await asUser(db, w.carol, () => q(db, `update public.ai_video_jobs set status = 'saving', claimed_at = now() where id = $1 and status = 'pending' returning id`, [id]));
    expect(claimed).toHaveLength(1);
    // Un second « claim » de la même tâche ne retrouve plus l'état d'attente.
    expect(await asUser(db, w.carol, () => q(db, `update public.ai_video_jobs set status = 'saving' where id = $1 and status = 'pending' returning id`, [id]))).toHaveLength(0);
    const m = await media(w.orgA, w.carol);
    await asUser(db, w.carol, () => q(db, `update public.ai_video_jobs set status = 'completed', media_id = $2 where id = $1`, [id, m]));
    expect((await q<{ status: string; media_id: string }>(db, 'select status, media_id from public.ai_video_jobs where id = $1', [id]))[0]).toEqual({ status: 'completed', media_id: m });
    await expect(asUser(db, w.carol, () => q(db, `update public.ai_video_jobs set prompt = 'autre' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.carol, () => q(db, `update public.ai_video_jobs set provider_task_id = 'autre' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, w.carol, () => q(db, `delete from public.ai_video_jobs where id = $1`, [id]))).rejects.toThrow(/permission denied/);
  });

  it('personne d’autre ne la modifie', async () => {
    const id = (await q<{ id: string }>(db, `select id from public.ai_video_jobs where provider_task_id = 'alice-task'`))[0]!.id;
    expect(await asUser(db, w.carol, () => q(db, `update public.ai_video_jobs set status = 'failed' where id = $1 returning id`, [id]))).toHaveLength(0);
    expect(await asUser(db, w.bob, () => q(db, `update public.ai_video_jobs set status = 'failed' where id = $1 returning id`, [id]))).toHaveLength(0);
  });

  it('la vidéo terminée doit être un média de la même organisation', async () => {
    const id = (await q<{ id: string }>(db, `select id from public.ai_video_jobs where provider_task_id = 'alice-task'`))[0]!.id;
    const foreign = await media(w.orgB, w.bob);
    await expect(asUser(db, w.alice, () => q(db, `update public.ai_video_jobs set status = 'completed', media_id = $2 where id = $1`, [id, foreign]))).rejects.toThrow(/n'appartient pas/);
  });

  it('supprimer la vidéo de la médiathèque garde la tâche, sans média', async () => {
    const id = (await asUser(db, w.alice, () => job(w.orgA, w.alice, 'alice-task-2')))[0]!.id;
    const m = await media(w.orgA, w.alice);
    await asUser(db, w.alice, () => q(db, `update public.ai_video_jobs set status = 'completed', media_id = $2 where id = $1`, [id, m]));
    await asUser(db, w.alice, () => q(db, 'delete from public.media where id = $1', [m]));
    expect((await q<{ status: string; media_id: string | null }>(db, 'select status, media_id from public.ai_video_jobs where id = $1', [id]))[0]).toEqual({ status: 'completed', media_id: null });
  });
});

describe('agent : messages et tâches', () => {
  it('un message de l’agent garde les identifiants des tâches qu’il a lancées', async () => {
    const t = (await asUser(db, w.alice, () => q<{ id: string }>(db, `insert into public.agent_threads (org_id, user_id, title) values ($1,$2,'Vidéo') returning id`, [w.orgA, w.alice])))[0]!.id;
    const j = (await q<{ id: string }>(db, `select id from public.ai_video_jobs where provider_task_id = 'alice-task'`))[0]!.id;
    await asUser(db, w.alice, () => q(db, `insert into public.agent_messages (thread_id, org_id, role, content, job_ids) values ($1,$2,'assistant','Lancée',$3::jsonb)`, [t, w.orgA, JSON.stringify([j])]));
    const rows = await asUser(db, w.alice, () => q<{ job_ids: string[] }>(db, 'select job_ids from public.agent_messages where thread_id = $1', [t]));
    expect(rows[0]!.job_ids).toEqual([j]);
    await expect(asUser(db, w.alice, () => q(db, `insert into public.agent_messages (thread_id, org_id, role, content, job_ids) values ($1,$2,'assistant','x','{"a":1}'::jsonb)`, [t, w.orgA]))).rejects.toThrow(/check/);
  });
});
