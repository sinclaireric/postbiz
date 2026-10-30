import { afterEach, describe, expect, it, vi } from 'vitest';

// `isDemo` est calculé à l'import d'après l'environnement : chaque test recharge le module avec le sien.
async function load(env: { url: string; key: string }, client?: unknown, workspaceCookie?: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.url);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', env.key);
  vi.doMock('next/headers', () => ({
    cookies: async () => ({ getAll: () => [], set: () => {}, get: (name: string) => (name === 'postbiz_org' && workspaceCookie ? { name, value: workspaceCookie } : undefined) }),
  }));
  if (client) {
    vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => client) }));
    vi.doMock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => client) }));
  }
  return import('./index');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@supabase/supabase-js');
  vi.doUnmock('@supabase/ssr');
  vi.resetModules();
});

/** Un client Supabase de poche : chaque requête de lecture rend la ligne prévue pour sa table. */
function fakeSupabase(opts: { user: { id: string; email: string } | null; memberships?: unknown[]; profile?: unknown }) {
  const getUser = vi.fn(async (token?: string) => ({ data: { user: token === 'valide' || token === undefined ? opts.user : null } }));
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: (table === 'memberships' ? opts.memberships?.[0] : opts.profile) ?? null });
    // La liste des appartenances s'attend sans `maybeSingle` : la requête elle-même est « thenable ».
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: table === 'memberships' ? (opts.memberships ?? []) : [] });
    return q;
  });
  return { auth: { getUser }, from };
}

describe('bearerToken', () => {
  it('lit un jeton Bearer, et rien d’autre', async () => {
    const { bearerToken } = await load({ url: '', key: '' });
    expect(bearerToken('Bearer abc.def-ghi_jkl')).toBe('abc.def-ghi_jkl');
    expect(bearerToken('  bearer   abc  ')).toBe('abc');
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe('getSessionForToken', () => {
  const supabaseEnv = { url: 'https://projet.supabase.test', key: 'cle-anonyme-de-test' };
  const membership = { role: 'member', organizations: { id: 'org-1', name: 'Maison Lune' } };
  const second = { role: 'admin', organizations: [{ id: 'org-2', name: 'Atelier Nord' }] };
  const user = { id: 'u-1', email: 'camille@maison-lune.example' };

  it('vérifie le jeton auprès de Supabase puis rend la session et des dépôts qui agissent avec ce jeton', async () => {
    const client = fakeSupabase({ user, memberships: [membership], profile: { display_name: 'Camille' } });
    const { getSessionForToken } = await load(supabaseEnv, client);
    const { session, repos } = await getSessionForToken('valide');
    expect(client.auth.getUser).toHaveBeenCalledWith('valide');
    expect(session).toEqual({ status: 'ready', ctx: { mode: 'supabase', user: { id: 'u-1', email: user.email, name: 'Camille' }, org: { id: 'org-1', name: 'Maison Lune', role: 'member' }, workspaces: [{ id: 'org-1', name: 'Maison Lune', role: 'member' }] } });
    expect(repos).not.toBeNull();
    expect(typeof repos!.agent.saveExchange).toBe('function');
  });

  it('ouvre le plus ancien espace par défaut, et liste tous les espaces de la personne', async () => {
    const { getSessionForToken } = await load(supabaseEnv, fakeSupabase({ user, memberships: [membership, second] }));
    const { session } = await getSessionForToken('valide');
    expect(session).toMatchObject({ status: 'ready', ctx: { org: { id: 'org-1' }, workspaces: [{ id: 'org-1', role: 'member' }, { id: 'org-2', name: 'Atelier Nord', role: 'admin' }] } });
  });

  it('ouvre l’espace demandé (en-tête du mobile) quand la personne en est membre, avec son rôle dans CET espace', async () => {
    const { getSessionForToken } = await load(supabaseEnv, fakeSupabase({ user, memberships: [membership, second] }));
    const { session } = await getSessionForToken('valide', 'org-2');
    expect(session).toMatchObject({ status: 'ready', ctx: { org: { id: 'org-2', name: 'Atelier Nord', role: 'admin' } } });
  });

  it('ignore un espace demandé dont la personne n’est pas membre : jamais de confiance à l’en-tête', async () => {
    const { getSessionForToken } = await load(supabaseEnv, fakeSupabase({ user, memberships: [membership, second] }));
    for (const forged of ['org-ghost', '', null, undefined, 'org-1 OR 1=1']) {
      const { session } = await getSessionForToken('valide', forged);
      expect(session, String(forged)).toMatchObject({ status: 'ready', ctx: { org: { id: 'org-1' } } });
    }
  });

  it('un jeton refusé ne donne ni session ni dépôts', async () => {
    const { getSessionForToken } = await load(supabaseEnv, fakeSupabase({ user, memberships: [membership] }));
    expect(await getSessionForToken('perime')).toEqual({ session: { status: 'anonymous' }, repos: null });
  });

  it('un utilisateur sans organisation (ou suspendu) n’a pas de dépôts', async () => {
    const { getSessionForToken } = await load(supabaseEnv, fakeSupabase({ user, memberships: [] }));
    const { session, repos } = await getSessionForToken('valide');
    expect(session.status).toBe('no-org');
    expect(repos).toBeNull();
  });

  it('envoie le jeton à Supabase sans rien garder de la session', async () => {
    const client = fakeSupabase({ user, memberships: [membership] });
    const mod = await load(supabaseEnv, client);
    const { createClient } = await import('@supabase/supabase-js');
    await mod.getSessionForToken('valide');
    expect(createClient).toHaveBeenCalledWith(supabaseEnv.url, supabaseEnv.key, { global: { headers: { Authorization: 'Bearer valide' } }, auth: { persistSession: false, autoRefreshToken: false } });
  });

  it('sans projet Supabase (démo), le jeton ne sert à rien : c’est la session de démonstration', async () => {
    const { getSessionForToken } = await load({ url: '', key: '' });
    const { session, repos } = await getSessionForToken('n-importe-quoi');
    expect(session).toMatchObject({ status: 'ready', ctx: { mode: 'demo' } });
    expect(repos).toBeNull();
  });
});

describe('getSession (navigateur)', () => {
  const supabaseEnv = { url: 'https://projet.supabase.test', key: 'cle-anonyme-de-test' };
  const user = { id: 'u-1', email: 'camille@maison-lune.example' };
  const memberships = [
    { role: 'member', organizations: { id: 'org-1', name: 'Maison Lune' } },
    { role: 'admin', organizations: { id: 'org-2', name: 'Atelier Nord' } },
  ];

  it('ouvre l’espace du cookie quand la personne en est membre', async () => {
    const { getSession } = await load(supabaseEnv, fakeSupabase({ user, memberships }), 'org-2');
    expect(await getSession()).toMatchObject({ status: 'ready', ctx: { org: { id: 'org-2', role: 'admin' } } });
  });

  it('un cookie vers un espace étranger (forgé, quitté ou supprimé) retombe sur le plus ancien espace de la personne', async () => {
    const { getSession } = await load(supabaseEnv, fakeSupabase({ user, memberships }), 'org-de-quelqu-un-d-autre');
    expect(await getSession()).toMatchObject({ status: 'ready', ctx: { org: { id: 'org-1' } } });
  });

  it('sans cookie, c’est le plus ancien espace', async () => {
    const { getSession } = await load(supabaseEnv, fakeSupabase({ user, memberships }));
    expect(await getSession()).toMatchObject({ status: 'ready', ctx: { org: { id: 'org-1' } } });
  });
});
