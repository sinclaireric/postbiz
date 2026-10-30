import { beforeAll, describe, expect, it } from 'vitest';
import { asService, createDb, q, seedWorld, type Db, type World } from './harness';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createDb();
  w = await seedWorld(db);
});

const claim = () => asService(db, () => q<{ id: string; attempts: number; error: string | null }>(db, 'select id, attempts, error from public.claim_due_posts(10, 60)'));

describe('report d’une publication refusée pour quota (la requête du worker)', () => {
  it('remet une publication « en cours » en file pour plus tard, puis elle est réclamée de nouveau à l’heure, avec une tentative de plus', async () => {
    const { id } = (await q<{ id: string }>(db,
      `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at) values ($1,$2,$3,'Vidéo','queued', now() - interval '1 minute') returning id`, [w.orgA, w.intA, w.alice]))[0]!;
    expect((await claim()).map((p) => [p.id, p.attempts])).toEqual([[id, 1]]);

    // La requête de reschedulePost (apps/worker/src/engine/db.ts), exécutée par le service_role.
    const moved = await asService(db, () => q(db,
      `update public.posts set state = 'queued', publish_at = now() + interval '9 hours', error = 'Quota épuisé', locked_until = null where id = $1 and state = 'publishing' returning id`, [id]));
    expect(moved).toHaveLength(1);
    const [row] = await q<{ state: string; error: string; locked_until: string | null }>(db, 'select state, error, locked_until from public.posts where id = $1', [id]);
    expect(row).toMatchObject({ state: 'queued', error: 'Quota épuisé', locked_until: null });

    expect(await claim()).toHaveLength(0); // pas avant l'heure du report

    await q(db, `update public.posts set publish_at = now() - interval '1 minute' where id = $1`, [id]);
    const again = await claim();
    expect(again.map((p) => [p.id, p.attempts, p.error])).toEqual([[id, 2, null]]); // deuxième tentative, message effacé
  });

  it('ne touche pas une publication qui n’est plus « en cours » (supprimée ou modifiée entre-temps)', async () => {
    const { id } = (await q<{ id: string }>(db,
      `insert into public.posts (org_id, integration_id, created_by, content, state, publish_at) values ($1,$2,$3,'Autre','draft', null) returning id`, [w.orgA, w.intA, w.alice]))[0]!;
    const moved = await asService(db, () => q(db,
      `update public.posts set state = 'queued', publish_at = now() + interval '9 hours' where id = $1 and state = 'publishing' returning id`, [id]));
    expect(moved).toHaveLength(0);
    expect((await q<{ state: string }>(db, 'select state from public.posts where id = $1', [id]))[0]!.state).toBe('draft');
  });
});
