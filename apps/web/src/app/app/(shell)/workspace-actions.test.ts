import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/lib/data';
import { DEMO_CONTEXT, demoRepositoriesFor, demoWorkspaces } from '@/lib/data/demo';

const state = vi.hoisted(() => ({
  session: null as unknown,
  cookies: new Map<string, string>(),
  revalidated: [] as string[],
  host: 'localhost:3104',
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined),
    set: (name: string, value: string) => void state.cookies.set(name, value),
    delete: (name: string) => void state.cookies.delete(name),
  }),
  headers: async () => new Headers({ host: state.host }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => void state.revalidated.push(path) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }));
vi.mock('@/lib/data', async () => ({
  getSession: async () => state.session,
  getRepositories: async (ctx: { org: { id: string } }) => demoRepositoriesFor(ctx.org.id),
}));

const shell = await import('./workspace-actions');
const settings = await import('./reglages/actions');
const COOKIE = 'postbiz_org';
const g = globalThis as unknown as Record<string, unknown>;

/** La session telle que la voit `getSession` : l'espace du moment parmi ceux de la démo. */
function sessionIn(orgId: string): SessionState {
  const workspaces = demoWorkspaces();
  const org = workspaces.find((w) => w.id === orgId)!;
  return { status: 'ready', ctx: { ...DEMO_CONTEXT, org, workspaces } };
}
const form = (fields: Record<string, string>) => Object.entries(fields).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData());
/** Une action qui redirige lève `redirect:<adresse>` ; on rend l'adresse. */
const redirected = async (run: () => Promise<unknown>) => {
  try { await run(); } catch (e) { const m = /^redirect:(.*)$/.exec((e as Error).message); if (m) return m[1]; throw e; }
  return null;
};

beforeEach(() => {
  delete g.__postbizDemo;
  delete g.__postbizDemoSpaces;
  delete g.__postbizDemoReceived;
  state.cookies.clear();
  state.revalidated = [];
  state.session = sessionIn('demo-org');
});

describe('switchWorkspaceAction', () => {
  it('mémorise un espace dont la personne est membre, et reste dans la même section', async () => {
    const to = await redirected(() => shell.switchWorkspaceAction(form({ orgId: 'demo-org-2', from: '/app/inbox' })));
    expect(to).toBe('/app/inbox');
    expect(state.cookies.get(COOKIE)).toBe('demo-org-2');
    expect(state.revalidated).toContain('/app');
  });

  it('ignore un espace dont la personne n’est pas membre : le cookie ne bouge pas', async () => {
    state.cookies.set(COOKIE, 'demo-org');
    for (const orgId of ['demo-org-99', '', '../admin', 'demo-org-2 ']) {
      await redirected(() => shell.switchWorkspaceAction(form({ orgId, from: '/app/medias' })));
      expect(state.cookies.get(COOKIE), orgId).toBe('demo-org');
    }
  });

  it('une adresse de retour hostile mène au calendrier', async () => {
    expect(await redirected(() => shell.switchWorkspaceAction(form({ orgId: 'demo-org-2', from: 'https://evil.example/' })))).toBe('/app/calendrier');
  });

  it('sans session, renvoie à la connexion et ne mémorise rien', async () => {
    state.session = { status: 'anonymous' };
    expect(await redirected(() => shell.switchWorkspaceAction(form({ orgId: 'demo-org-2' })))).toBe('/login');
    expect(state.cookies.has(COOKIE)).toBe(false);
  });
});

describe('createWorkspaceAction', () => {
  it('crée l’espace, l’ouvre et lance la configuration des canaux', async () => {
    const to = await redirected(() => shell.createWorkspaceAction({}, form({ name: '  Atelier   Nord ' })));
    expect(to).toBe('/app/calendrier?onboarding=true');
    const created = demoWorkspaces().at(-1)!;
    expect(created).toMatchObject({ name: 'Atelier Nord', role: 'admin' });
    expect(state.cookies.get(COOKIE)).toBe(created.id);
  });

  it('refuse un nom trop court et le garde dans le champ', async () => {
    const res = await shell.createWorkspaceAction({}, form({ name: ' a ' }));
    expect(res).toEqual({ error: 'app.settings.errNameLength', name: 'a' });
    expect(demoWorkspaces()).toHaveLength(2);
  });

  it('reprend les membres de l’espace courant quand la case est cochée', async () => {
    await redirected(() => shell.createWorkspaceAction({}, form({ name: 'Copie', copyMembers: 'on' })));
    const created = demoWorkspaces().at(-1)!;
    expect(await demoRepositoriesFor(created.id).workspace.members()).toHaveLength(4);
  });

  it('une personne qui n’administre aucun espace n’en crée pas', async () => {
    state.session = { status: 'ready', ctx: { ...DEMO_CONTEXT, org: { id: 'x', name: 'X', role: 'member' }, workspaces: [{ id: 'x', name: 'X', role: 'member' }] } };
    expect(await shell.createWorkspaceAction({}, form({ name: 'Nouveau' }))).toMatchObject({ error: 'app.workspace.errors.notAdmin' });
    expect(demoWorkspaces()).toHaveLength(2);
  });
});

describe('invitations reçues', () => {
  it('un lien mal formé renvoie aux Réglages, sans interroger personne', async () => {
    expect(await redirected(() => shell.acceptInvitationAction(form({ token: 'pas-un-jeton' })))).toBe('/app/reglages');
  });

  it('accepter un lien valide ouvre l’espace rejoint', async () => {
    const to = await redirected(() => shell.acceptInvitationAction(form({ token: 'd3a0'.repeat(16) })));
    expect(to).toBe('/app/calendrier');
    const joined = demoWorkspaces().at(-1)!;
    expect(joined).toMatchObject({ name: 'Studio Aube', role: 'member' });
    expect(state.cookies.get(COOKIE)).toBe(joined.id);
  });

  it('un lien périmé ramène à la page du lien, qui l’explique', async () => {
    const token = 'ab'.repeat(32);
    expect(await redirected(() => shell.acceptInvitationAction(form({ token })))).toBe(`/app/invitation/${token}`);
    expect(state.cookies.has(COOKIE)).toBe(false);
  });

  it('accepter depuis la liste ouvre l’espace ; refuser l’efface', async () => {
    const [invitation] = await demoRepositoriesFor('demo-org').workspace.receivedInvitations();
    expect(await redirected(() => shell.acceptReceivedInvitationAction(form({ id: invitation!.id })))).toBe('/app/calendrier');
    expect(demoWorkspaces()).toHaveLength(3);
    expect(await redirected(() => shell.declineReceivedInvitationAction(form({ id: 'inv-demo-1' })))).toBe('/app/reglages');
  });
});

describe('memberAction', () => {
  it('change le rôle d’un membre (administrateur) ; un rôle inconnu est refusé', async () => {
    expect(await settings.memberAction({}, form({ intent: 'role', userId: 'u2', role: 'viewer' }))).toEqual({ done: true });
    expect((await demoRepositoriesFor('demo-org').workspace.members()).find((m) => m.userId === 'u2')?.role).toBe('viewer');
    expect(await settings.memberAction({}, form({ intent: 'role', userId: 'u2', role: 'owner' }))).toEqual({ error: 'app.errors.generic' });
  });

  it('refuse de retirer le dernier administrateur, avec le message de la règle', async () => {
    const res = await settings.memberAction({}, form({ intent: 'remove', userId: 'demo-user' }));
    expect(res).toEqual({ error: 'app.workspace.errors.lastAdmin' });
  });

  it('un membre ne change aucun rôle', async () => {
    state.session = sessionIn('demo-org-2');
    expect(await settings.memberAction({}, form({ intent: 'role', userId: 'u6', role: 'admin' }))).toEqual({ error: 'app.workspace.errors.forbidden' });
  });

  it('quitter l’espace où l’on est ramène aux Réglages', async () => {
    state.session = sessionIn('demo-org-2');
    expect(await redirected(() => settings.memberAction({}, form({ intent: 'remove', userId: 'demo-user' })))).toBe('/app/reglages');
    expect(demoWorkspaces().map((w) => w.id)).toEqual(['demo-org']);
  });
});

describe('inviteMemberAction', () => {
  it('rend le lien de la page d’invitation, à l’adresse du serveur qui répond (démo)', async () => {
    const res = await settings.inviteMemberAction({}, form({ email: ' Nora@Example.com ', role: 'viewer' }));
    expect(res.link).toMatch(/^http:\/\/localhost:3104\/app\/invitation\/[0-9a-f]{64}$/);
    expect(res.email).toBe('nora@example.com');
    const [pending] = await demoRepositoriesFor('demo-org').workspace.invitations();
    expect(pending).toMatchObject({ email: 'nora@example.com', role: 'viewer' });
  });

  it('refuse une adresse invalide, un membre qui invite, et une adresse déjà membre', async () => {
    expect(await settings.inviteMemberAction({}, form({ email: 'nope' }))).toEqual({ error: 'auth.validation.emailInvalid' });
    expect(await settings.inviteMemberAction({}, form({ email: 'hugo@maison-lune.example' }))).toMatchObject({ error: 'app.workspace.errors.alreadyMember' });
    state.session = sessionIn('demo-org-2');
    expect(await settings.inviteMemberAction({}, form({ email: 'a@b.co' }))).toEqual({ error: 'app.workspace.errors.forbidden' });
  });
});

describe('deleteWorkspaceAction', () => {
  it('demande le nom exact de l’espace', async () => {
    const id = await (async () => { const r = await demoRepositoriesFor('demo-org').workspace.create('Condamné', false); return r.ok ? r.id : ''; })();
    state.session = sessionIn(id);
    expect(await settings.deleteWorkspaceAction({}, form({ confirm: 'condamné' }))).toEqual({ error: 'app.workspace.errors.nameMismatch' });
    expect(await settings.deleteWorkspaceAction({}, form({ confirm: '' }))).toEqual({ error: 'app.workspace.errors.nameMismatch' });
    expect(demoWorkspaces().map((w) => w.id)).toContain(id);
  });

  it('supprime l’espace, oublie le cookie et revient aux Réglages', async () => {
    const created = await demoRepositoriesFor('demo-org').workspace.create('Condamné', false);
    if (!created.ok) throw new Error('création');
    state.session = sessionIn(created.id);
    state.cookies.set(COOKIE, created.id);
    expect(await redirected(() => settings.deleteWorkspaceAction({}, form({ confirm: '  Condamné ' })))).toBe('/app/reglages');
    expect(demoWorkspaces().map((w) => w.id)).toEqual(['demo-org', 'demo-org-2']);
    expect(state.cookies.has(COOKIE)).toBe(false);
  });

  it('rend le message de la base quand il reste des canaux, et refuse à un membre', async () => {
    expect(await settings.deleteWorkspaceAction({}, form({ confirm: 'Maison Lune' }))).toEqual({ error: 'app.workspace.errors.hasChannels' });
    state.session = sessionIn('demo-org-2');
    expect(await settings.deleteWorkspaceAction({}, form({ confirm: 'Café du Port' }))).toEqual({ error: 'app.workspace.errors.forbidden' });
  });
});
