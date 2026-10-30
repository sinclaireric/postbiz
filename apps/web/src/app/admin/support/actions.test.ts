import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoThread, demoSend, resetDemoSupport } from '@/lib/support/demo';

const state = vi.hoisted(() => ({ access: { status: 'admin', id: 'a', email: 'owner@x.test' } as { status: string }, revalidated: [] as string[] }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string, type?: string) => void state.revalidated.push(`${path}:${type ?? ''}`) }));
vi.mock('@/lib/admin/data', () => ({ getAdminAccess: async () => state.access }));

const actions = await import('./actions');
const ID = '00000000-0000-4000-a000-000000000101'; // conversation d'exemple avec deux messages non lus

beforeEach(() => {
  resetDemoSupport();
  state.access = { status: 'admin' };
  state.revalidated = [];
});

describe('actions du support (espace propriétaire)', () => {
  it('refusent tout appelant qui n’est pas le propriétaire, sans rien modifier', async () => {
    for (const status of ['forbidden', 'anonymous']) {
      state.access = { status };
      expect(await actions.replyAction(ID, 'bonjour')).toEqual({ ok: false, code: 'forbidden' });
      expect(await actions.setStatusAction(ID, 'resolved')).toEqual({ ok: false, code: 'forbidden' });
      expect(await actions.refreshThreadAction(ID)).toEqual({ ok: false, code: 'forbidden' });
      await actions.markReadAction(ID);
    }
    expect(state.revalidated).toEqual([]);
    const { demoAdminThread } = await import('@/lib/support/demo');
    expect(demoAdminThread(ID)).toMatchObject({ conversation: { status: 'open', supportUnread: 2 } });
    expect(demoAdminThread(ID)!.messages).toHaveLength(2);
  });

  it('répond, rend le fil à jour et recalcule la mise en page (pastille des non-lus)', async () => {
    demoSend({ id: 'demo-user', name: 'Camille', email: 'c@x.test' }, 'Maison Lune', 'Question');
    const res = await actions.replyAction(ID, '  Bonjour Léa.  ');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.thread.messages.at(-1)).toMatchObject({ author: 'support', body: 'Bonjour Léa.' });
      expect(res.thread.conversation.supportUnread).toBe(0);
    }
    expect(state.revalidated).toContain('/admin:layout');
    expect(demoThread('demo-user').messages).toHaveLength(1); // la réponse est pour Léa, pas pour la personne connectée
  });

  it('refuse une réponse vide ou trop longue, une conversation qui n’existe pas ou dont l’identifiant est mal formé', async () => {
    expect(await actions.replyAction(ID, '   ')).toEqual({ ok: false, code: 'invalid_message' });
    expect(await actions.replyAction(ID, 'x'.repeat(4001))).toEqual({ ok: false, code: 'message_too_long' });
    expect(await actions.replyAction('00000000-0000-4000-a000-0000000009ff', 'Bonjour')).toEqual({ ok: false, code: 'not_found' });
    expect(await actions.replyAction('../../x', 'Bonjour')).toEqual({ ok: false, code: 'not_found' });
    expect(state.revalidated).toEqual([]);
  });

  it('résout et rouvre, lit et relit', async () => {
    const resolved = await actions.setStatusAction(ID, 'resolved');
    expect(resolved.ok && resolved.thread.conversation.status).toBe('resolved');
    const reopened = await actions.setStatusAction(ID, 'open');
    expect(reopened.ok && reopened.thread.conversation.resolvedAt).toBeNull();
    expect(await actions.setStatusAction(ID, 'closed' as never)).toEqual({ ok: false, code: 'not_found' });
    const fresh = await actions.refreshThreadAction(ID);
    expect(fresh.ok && fresh.thread.messages).toHaveLength(2);
    await actions.markReadAction(ID);
    const read = await actions.refreshThreadAction(ID);
    expect(read.ok && read.thread.conversation.supportUnread).toBe(0);
    expect(await actions.refreshThreadAction('00000000-0000-4000-a000-0000000009ff')).toEqual({ ok: false, code: 'not_found' });
  });
});
