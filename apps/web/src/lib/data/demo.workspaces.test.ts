import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_INVITATION_TOKEN, demoConnectChannel, demoRepositoriesFor, demoWorkspaces, inDemoWorkspace } from './demo';

const MAIN = 'demo-org';
const CAFE = 'demo-org-2';
const g = globalThis as unknown as Record<string, unknown>;

// La démo garde ses espaces en mémoire du processus : chaque test repart de l'état d'origine.
beforeEach(() => {
  delete g.__postbizDemo;
  delete g.__postbizDemoSpaces;
  delete g.__postbizDemoReceived;
});

const main = () => demoRepositoriesFor(MAIN);
const cafe = () => demoRepositoriesFor(CAFE);
const create = async (name: string, copyMembers = false, from = MAIN) => {
  const res = await demoRepositoriesFor(from).workspace.create(name, copyMembers);
  if (!res.ok) throw new Error(`création refusée : ${res.error.key}`);
  return res.id;
};
const keyOf = (res: { ok: boolean; error?: { key: string } }) => (res.ok ? 'ok' : res.error?.key);

describe('les espaces de la démo', () => {
  it('commence par deux espaces : « Maison Lune » où l’on administre, « Café du Port » où l’on est membre', () => {
    expect(demoWorkspaces()).toEqual([
      { id: MAIN, name: 'Maison Lune', role: 'admin' },
      { id: CAFE, name: 'Café du Port', role: 'member' },
    ]);
  });

  it('chaque espace a ses propres données : l’espace d’exemple est rempli, les autres sont vides', async () => {
    expect((await main().workspace.integrations()).length).toBeGreaterThan(0);
    expect((await main().posts.list()).length).toBeGreaterThan(0);
    expect((await main().inbox.listConversations()).length).toBeGreaterThan(0);
    expect(await cafe().workspace.integrations()).toEqual([]);
    expect(await cafe().posts.list()).toEqual([]);
    expect(await cafe().inbox.listConversations()).toEqual([]);
    const fresh = await create('Atelier Nord');
    expect(await demoRepositoriesFor(fresh).workspace.integrations()).toEqual([]);
    expect(await demoRepositoriesFor(fresh).posts.list()).toEqual([]);
    expect(await demoRepositoriesFor(fresh).knowledge.list()).toEqual([]);
  });

  it('ce qu’on écrit dans un espace n’apparaît pas dans un autre, même quand les requêtes se croisent', async () => {
    const fresh = await create('Atelier Nord');
    await Promise.all([
      main().workspace.renameOrganization('Maison Lune 2'),
      demoRepositoriesFor(fresh).workspace.renameOrganization('Nord 2'),
      cafe().workspace.renameOrganization('Port 2'),
    ]);
    expect(demoWorkspaces().map((w) => w.name)).toEqual(['Maison Lune 2', 'Port 2', 'Nord 2']);
    inDemoWorkspace(fresh, () => demoConnectChannel('facebook', 'Page Nord'));
    expect((await demoRepositoriesFor(fresh).workspace.integrations()).map((i) => i.name)).toEqual(['Page Nord']);
    expect((await main().workspace.integrations()).map((i) => i.name)).not.toContain('Page Nord');
    expect(await cafe().workspace.integrations()).toEqual([]);
  });
});

describe('créer un espace', () => {
  it('le nouvel espace est le dernier de la liste ; la personne en est l’administratrice, seule', async () => {
    const id = await create('Boutique');
    expect(demoWorkspaces().at(-1)).toEqual({ id, name: 'Boutique', role: 'admin' });
    expect(await demoRepositoriesFor(id).workspace.members()).toMatchObject([{ userId: 'demo-user', role: 'admin' }]);
  });

  it('peut reprendre les membres de l’espace courant, avec leur rôle ; seul un administrateur le peut', async () => {
    const copy = await create('Copie', true);
    const members = await demoRepositoriesFor(copy).workspace.members();
    expect(members.map((m) => [m.name, m.role])).toEqual([['Camille', 'admin'], ['Hugo', 'member'], ['Nora', 'member'], ['Léo', 'viewer']]);
    const fromCafe = await create('Depuis le café', true, CAFE);
    expect(await demoRepositoriesFor(fromCafe).workspace.members()).toHaveLength(1);
  });

  it('refuse la onzième création : 10 espaces créés au plus (celui qu’on nous a ouvert ne compte pas)', async () => {
    for (let i = 2; i <= 10; i++) await create(`Espace ${i}`);
    const res = await main().workspace.create('De trop', false);
    expect(res).toMatchObject({ ok: false, error: { key: 'app.workspace.errors.limit', params: { max: 10 } } });
    expect(demoWorkspaces()).toHaveLength(11);
  });
});

describe('membres et rôles', () => {
  it('les adresses ne sont données qu’aux administrateurs', async () => {
    expect((await main().workspace.members()).every((m) => m.email)).toBe(true);
    expect((await cafe().workspace.members()).every((m) => m.email === null)).toBe(true);
  });

  it('un administrateur change les rôles ; un membre ne le peut pas', async () => {
    expect(keyOf(await main().workspace.setMemberRole('u2', 'viewer'))).toBe('ok');
    expect((await main().workspace.members()).find((m) => m.userId === 'u2')?.role).toBe('viewer');
    expect(keyOf(await cafe().workspace.setMemberRole('u6', 'admin'))).toBe('app.workspace.errors.forbidden');
  });

  it('le seul administrateur ne peut ni se rétrograder ni être retiré ; avec un second administrateur, oui', async () => {
    expect(keyOf(await main().workspace.setMemberRole('demo-user', 'member'))).toBe('app.workspace.errors.lastAdmin');
    expect(keyOf(await main().workspace.removeMember('demo-user'))).toBe('app.workspace.errors.lastAdmin');
    await main().workspace.setMemberRole('u2', 'admin');
    expect(keyOf(await main().workspace.setMemberRole('demo-user', 'member'))).toBe('ok');
    expect(demoWorkspaces()[0]!.role).toBe('member');
  });

  it('un administrateur retire un membre ; un membre ne retire personne', async () => {
    expect(keyOf(await main().workspace.removeMember('u4'))).toBe('ok');
    expect((await main().workspace.members()).map((m) => m.userId)).not.toContain('u4');
    expect(keyOf(await cafe().workspace.removeMember('u6'))).toBe('app.workspace.errors.forbidden');
  });

  it('quitter un espace le retire de la liste, sauf le dernier', async () => {
    expect(keyOf(await cafe().workspace.removeMember('demo-user'))).toBe('ok');
    expect(demoWorkspaces().map((w) => w.id)).toEqual([MAIN]);
    await main().workspace.setMemberRole('u2', 'admin');
    expect(keyOf(await main().workspace.removeMember('demo-user'))).toBe('app.workspace.errors.lastWorkspace');
  });
});

describe('supprimer un espace', () => {
  it('refusé à un membre, et refusé s’il ne reste qu’un espace', async () => {
    expect(keyOf(await cafe().workspace.remove())).toBe('app.workspace.errors.forbidden');
    const only = await create('Seul à bord');
    await demoRepositoriesFor(only).workspace.remove();
    await cafe().workspace.removeMember('demo-user');
    expect(keyOf(await main().workspace.remove())).toBe('app.workspace.errors.lastWorkspace');
  });

  it('refusé tant qu’un canal est connecté ou qu’une publication est en file', async () => {
    const id = await create('À supprimer');
    const repos = demoRepositoriesFor(id);
    inDemoWorkspace(id, () => demoConnectChannel('facebook', 'Page'));
    expect(keyOf(await repos.workspace.remove())).toBe('app.workspace.errors.hasChannels');
    expect(keyOf(await main().workspace.remove())).toBe('app.workspace.errors.hasChannels');
  });

  it('un espace vide disparaît de la liste, les autres restent', async () => {
    const id = await create('Éphémère');
    expect(keyOf(await demoRepositoriesFor(id).workspace.remove())).toBe('ok');
    expect(demoWorkspaces().map((w) => w.id)).toEqual([MAIN, CAFE]);
  });
});

describe('invitations', () => {
  it('un administrateur invite : jeton de 64 caractères, invitation visible en attente', async () => {
    const res = await main().workspace.invite('nora.neuve@example.com', 'viewer');
    expect(res).toMatchObject({ ok: true, token: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const list = await main().workspace.invitations();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: 'nora.neuve@example.com', role: 'viewer' });
    expect(new Date(list[0]!.expiresAt).getTime() - new Date(list[0]!.createdAt).getTime()).toBe(7 * 24 * 3_600_000);
  });

  it('inviter de nouveau la même adresse remplace le lien ; une autre invitation s’ajoute', async () => {
    const a = await main().workspace.invite('a@example.com', 'member');
    const b = await main().workspace.invite('a@example.com', 'admin');
    await main().workspace.invite('c@example.com', 'member');
    expect(a.ok && b.ok && a.token !== b.token).toBe(true);
    const list = await main().workspace.invitations();
    expect(list.map((i) => [i.email, i.role])).toEqual([['a@example.com', 'admin'], ['c@example.com', 'member']]);
    if (a.ok) expect(await main().workspace.acceptInvitation(a.token)).toMatchObject({ ok: false });
  });

  it('refuse un membre ou une adresse déjà membre, et plus de 50 invitations en attente', async () => {
    expect(keyOf(await cafe().workspace.invite('x@example.com', 'member'))).toBe('app.workspace.errors.forbidden');
    expect(keyOf(await main().workspace.invite('hugo@maison-lune.example', 'member'))).toBe('app.workspace.errors.alreadyMember');
    for (let i = 0; i < 50; i++) await main().workspace.invite(`p${i}@example.com`, 'viewer');
    expect(keyOf(await main().workspace.invite('de-trop@example.com', 'viewer'))).toBe('app.workspace.errors.invitationLimit');
    expect(keyOf(await main().workspace.invite('p3@example.com', 'viewer'))).toBe('ok');
  });

  it('révoquer retire l’invitation ; les membres ne voient pas les invitations', async () => {
    await main().workspace.invite('a@example.com', 'member');
    const [first] = await main().workspace.invitations();
    expect(await cafe().workspace.invitations()).toEqual([]);
    expect(keyOf(await cafe().workspace.revokeInvitation(first!.id))).toBe('app.workspace.errors.forbidden');
    await main().workspace.revokeInvitation(first!.id);
    expect(await main().workspace.invitations()).toEqual([]);
  });

  it('la page du lien montre l’espace ; la personne en est déjà membre, l’accepter consomme le lien sans changer son rôle', async () => {
    const res = await main().workspace.invite('moi@example.com', 'viewer');
    if (!res.ok) throw new Error('invitation');
    expect(await main().workspace.previewInvitation(res.token)).toMatchObject({ orgId: MAIN, orgName: 'Maison Lune', role: 'viewer', alreadyMember: true });
    expect(await main().workspace.acceptInvitation(res.token)).toEqual({ ok: true, orgId: MAIN });
    expect(demoWorkspaces()[0]!.role).toBe('admin');
    expect(await main().workspace.previewInvitation(res.token)).toBeNull();
  });

  it('un jeton inconnu ne donne rien', async () => {
    expect(await main().workspace.previewInvitation('0'.repeat(64))).toBeNull();
    expect(keyOf(await main().workspace.acceptInvitation('0'.repeat(64)))).toBe('app.workspace.errors.invitationInvalid');
  });
});

describe('invitations reçues', () => {
  it('la démo en a une, du « Studio Aube » ; accepter ouvre l’espace avec le rôle proposé', async () => {
    const received = await main().workspace.receivedInvitations();
    expect(received).toMatchObject([{ orgName: 'Studio Aube', role: 'member', inviterName: 'Léa' }]);
    const joined = await main().workspace.acceptReceivedInvitation(received[0]!.id);
    expect(joined).toMatchObject({ ok: true, orgId: expect.stringMatching(/^demo-org-/) });
    expect(demoWorkspaces().at(-1)).toMatchObject({ name: 'Studio Aube', role: 'member' });
    expect(await main().workspace.receivedInvitations()).toEqual([]);
    expect(keyOf(await main().workspace.acceptReceivedInvitation(received[0]!.id))).toBe('app.workspace.errors.invitationInvalid');
  });

  it('le lien de la démo montre l’invitation puis ouvre l’espace', async () => {
    expect(await main().workspace.previewInvitation(DEMO_INVITATION_TOKEN)).toMatchObject({ orgName: 'Studio Aube', alreadyMember: false });
    const joined = await main().workspace.acceptInvitation(DEMO_INVITATION_TOKEN);
    expect(joined.ok).toBe(true);
    expect(demoWorkspaces()).toHaveLength(3);
  });

  it('refuser l’efface sans rien ouvrir', async () => {
    const [i] = await main().workspace.receivedInvitations();
    await main().workspace.declineReceivedInvitation(i!.id);
    expect(await main().workspace.receivedInvitations()).toEqual([]);
    expect(demoWorkspaces()).toHaveLength(2);
  });
});
