import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/lib/data';
import { DEMO_CONTEXT, demoRepositories } from '@/lib/data/demo';

const state = vi.hoisted(() => ({ session: null as unknown, run: null as unknown as ReturnType<typeof import('vitest').vi.fn> }));
vi.mock('@/i18n/server', () => ({ getLocale: async () => 'fr' }));
vi.mock('@/lib/data', async () => ({ getSession: async () => state.session, getRepositories: async () => (await import('@/lib/data/demo')).demoRepositories }));
vi.mock('@/lib/kb/embed', async (original) => ({ ...(await original<typeof import('@/lib/kb/embed')>()), defaultEmbedder: () => null }));
vi.mock('@/lib/ai/assistant', async (original) => ({
  ...(await original<typeof import('@/lib/ai/assistant')>()),
  aiConfigured: () => true,
  runAssist: (...args: unknown[]) => state.run(...args),
}));

const { assistAction } = await import('./ai-actions');

const ready = (over: { id?: string; role?: 'admin' | 'member' | 'viewer' } = {}): SessionState => ({
  status: 'ready', ctx: { ...DEMO_CONTEXT, mode: 'demo', user: { ...DEMO_CONTEXT.user, id: over.id ?? 'u-' + Math.random() }, org: { ...DEMO_CONTEXT.org, role: over.role ?? 'admin' } },
});
const write = { mode: 'write', topic: 'Soldes d’hiver', networkIds: ['instagram'] };

// Un test qui échoue avant de rendre son espion ne doit pas fausser le suivant.
afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  state.session = ready();
  state.run = vi.fn(async () => ({ ok: true, mode: 'write', proposals: [] }));
});

describe('assistAction : quota d’IA de l’offre', () => {
  it('une demande compte pour une action « assistant », réservée avant l’appel au fournisseur', async () => {
    const reserve = vi.spyOn(demoRepositories.generation, 'reserveText').mockResolvedValue(true);
    expect(await assistAction(write)).toMatchObject({ ok: true });
    expect(reserve).toHaveBeenCalledExactlyOnceWith('assistant');
    expect(state.run).toHaveBeenCalledTimes(1);
    reserve.mockRestore();
  });

  it('quota épuisé : le code « quota », sans appeler le fournisseur', async () => {
    const reserve = vi.spyOn(demoRepositories.generation, 'reserveText').mockResolvedValue(false);
    expect(await assistAction(write)).toEqual({ ok: false, error: 'quota' });
    expect(reserve).toHaveBeenCalledExactlyOnceWith('assistant');
    expect(state.run).not.toHaveBeenCalled();
    reserve.mockRestore();
  });

  it('les idées comptent aussi pour une action', async () => {
    const reserve = vi.spyOn(demoRepositories.generation, 'reserveText').mockResolvedValue(false);
    expect(await assistAction({ mode: 'ideas', theme: 'Automne', news: true, knowledge: false })).toEqual({ ok: false, error: 'quota' });
    expect(reserve).toHaveBeenCalledExactlyOnceWith('assistant');
    reserve.mockRestore();
  });

  it('une demande refusée plus tôt (lecteur, demande invalide, trop de demandes) ne consomme aucune action', async () => {
    const reserve = vi.spyOn(demoRepositories.generation, 'reserveText');
    state.session = ready({ role: 'viewer' });
    expect(await assistAction(write)).toEqual({ ok: false, error: 'forbidden' });
    state.session = { status: 'anonymous' } satisfies SessionState;
    expect(await assistAction(write)).toEqual({ ok: false, error: 'forbidden' });
    state.session = ready();
    expect(await assistAction({ mode: 'write', topic: '   ' })).toEqual({ ok: false, error: 'invalid' });
    state.session = ready({ id: 'bavard-quota' });
    const codes: unknown[] = [];
    for (let i = 0; i < 40; i++) codes.push(((await assistAction(write)) as { error?: string }).error);
    expect(codes).toContain('rate_limited');
    // Les demandes limitées par le rythme n'ont pas été réservées : seules celles qui sont allées jusqu'au fournisseur comptent.
    expect(reserve.mock.calls.length).toBe(state.run.mock.calls.length);
    reserve.mockRestore();
  });
});
