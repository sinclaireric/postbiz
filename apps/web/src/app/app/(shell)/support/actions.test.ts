import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CONTEXT } from '@/lib/data/demo';
import { demoAdminReply, resetDemoSupport } from '@/lib/support/demo';

const state = vi.hoisted(() => ({ session: null as unknown, revalidated: [] as string[] }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string, type?: string) => void state.revalidated.push(`${path}:${type ?? ''}`) }));
vi.mock('@/lib/data', () => ({ getSession: async () => state.session }));

const actions = await import('./actions');

beforeEach(() => {
  resetDemoSupport();
  state.session = { status: 'ready', ctx: DEMO_CONTEXT };
  state.revalidated = [];
});

describe('actions du chat de support (utilisateur)', () => {
  it('refusent une personne non connectée, ou une session sans espace', async () => {
    for (const session of [{ status: 'anonymous' }, { status: 'no-org', user: { id: 'u' } }]) {
      state.session = session;
      expect(await actions.sendSupportMessageAction('bonjour')).toEqual({ ok: false, code: 'failed' });
      expect(await actions.refreshSupportAction()).toEqual({ ok: false });
      expect(await actions.supportUnreadAction()).toBeNull();
      await actions.markSupportReadAction();
    }
    expect(state.revalidated).toEqual([]);
  });

  it('envoie, relit, compte les réponses non lues puis les marque lues', async () => {
    const sent = await actions.sendSupportMessageAction('  Bonjour  ');
    expect(sent.ok && sent.thread.messages.map((m) => m.body)).toEqual(['Bonjour']);
    const id = sent.ok ? sent.thread.conversationId! : '';
    demoAdminReply(id, 'Bonjour Camille');
    expect(await actions.supportUnreadAction()).toBe(1);
    const fresh = await actions.refreshSupportAction();
    expect(fresh.ok && fresh.thread).toMatchObject({ unread: 1 });
    await actions.markSupportReadAction();
    expect(await actions.supportUnreadAction()).toBe(0);
    expect(state.revalidated).toContain('/app:layout');
  });

  it('refuse un corps qui n’est pas du texte, un message vide et un message trop long', async () => {
    expect(await actions.sendSupportMessageAction({ not: 'a string' } as never)).toEqual({ ok: false, code: 'failed' });
    expect(await actions.sendSupportMessageAction('  ')).toEqual({ ok: false, code: 'invalid_message' });
    expect(await actions.sendSupportMessageAction('x'.repeat(2001))).toEqual({ ok: false, code: 'message_too_long' });
  });
});
