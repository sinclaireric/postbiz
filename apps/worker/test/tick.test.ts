import { describe, expect, it, vi } from 'vitest';
import { tick } from '../src/engine/tick.ts';
import { createRegistry } from '../src/providers/registry.ts';
import { fakeDb } from './fakes.ts';

function fakeSupabase(rpcs: Record<string, unknown>) {
  const calls: [string, unknown][] = [];
  return {
    calls,
    client: {
      rpc: vi.fn(async (name: string, args?: unknown) => {
        calls.push([name, args]);
        const v = rpcs[name];
        if (v instanceof Error) return { data: null, error: { message: v.message } };
        return { data: v ?? null, error: null };
      }),
    } as any,
  };
}

describe('tick', () => {
  it('balaie, réclame, puis traite publications et réponses', async () => {
    const db = fakeDb();
    const { client, calls } = fakeSupabase({
      sweep_stale_work: { posts_unknown: 1, messages_failed: 0, comments_unknown: 0 },
      claim_due_posts: [{ id: 'post-1', org_id: 'org-1', integration_id: 'int-1', content: 'x', media: [], settings: {}, created_by: 'user-1' }],
      claim_outbound_messages: [],
      claim_first_comments: [],
    });
    const stats = await tick({ supabase: client, db, providers: createRegistry({ dryRun: true }) }, { posts: 5, messages: 20 });
    expect(calls.map(([n]) => n)).toEqual(['sweep_stale_work', 'claim_due_posts', 'claim_outbound_messages', 'claim_first_comments']);
    expect(stats).toEqual({ swept: { posts_unknown: 1, messages_failed: 0, comments_unknown: 0 }, posts: 1, messages: 0, comments: 0 });
    expect(db.markPublished).toHaveBeenCalledWith('post-1', { releaseId: 'dry-run-post-1', releaseUrl: null });
  });

  it('ne réclame rien si le balayage échoue', async () => {
    const { client, calls } = fakeSupabase({ sweep_stale_work: new Error('db down') });
    await expect(tick({ supabase: client, db: fakeDb(), providers: () => null }, { posts: 5, messages: 20 })).rejects.toThrow(/sweep_stale_work/);
    expect(calls).toHaveLength(1);
  });

  it('une erreur sur un élément n’empêche pas le traitement des autres', async () => {
    const db = fakeDb({ markPublished: vi.fn(async (id: string) => { if (id === 'a') throw new Error('x'); }) });
    const row = (id: string) => ({ id, org_id: 'o', integration_id: 'int-1', content: 'x', media: [], settings: {}, created_by: null });
    const { client } = fakeSupabase({ sweep_stale_work: {}, claim_due_posts: [row('a'), row('b')], claim_outbound_messages: [] });
    await tick({ supabase: client, db, providers: createRegistry({ dryRun: true }) }, { posts: 5, messages: 20 });
    expect(db.markPublished).toHaveBeenCalledWith('b', expect.anything());
    expect(db.markPostFailed).toHaveBeenCalledWith('a', 'unknown', expect.any(String));
  });

  it('publie le premier commentaire d’un post déjà publié, avec l’identifiant du réseau', async () => {
    const db = fakeDb();
    const row = { id: 'post-9', org_id: 'org-1', integration_id: 'int-1', content: 'x', media: [], settings: {}, created_by: 'user-1', release_id: 'REL_9', first_comment: 'Dites-nous tout 👇' };
    const { client, calls } = fakeSupabase({ sweep_stale_work: {}, claim_due_posts: [], claim_outbound_messages: [], claim_first_comments: [row] });
    const stats = await tick({ supabase: client, db, providers: createRegistry({ dryRun: true }) }, { posts: 5, messages: 20, comments: 3 });
    expect(stats.comments).toBe(1);
    expect(calls.find(([n]) => n === 'claim_first_comments')![1]).toEqual({ p_limit: 3, p_lock_seconds: 300 });
    expect(db.completeFirstComment).toHaveBeenCalledWith('post-9', 'dry-run-comment-REL_9');
  });

  it('ne réclame rien si la réclamation des commentaires échoue', async () => {
    const { client } = fakeSupabase({ sweep_stale_work: {}, claim_due_posts: [], claim_outbound_messages: [], claim_first_comments: new Error('db down') });
    await expect(tick({ supabase: client, db: fakeDb(), providers: () => null }, { posts: 5, messages: 20 })).rejects.toThrow(/claim_first_comments/);
  });
});
