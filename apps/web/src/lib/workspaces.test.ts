import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adminCount, canCreateWorkspace, canManageWorkspace, INVITATION_DAYS, invitationPath, isInvitationToken, isOrgRole, MAX_PENDING_INVITATIONS, MAX_WORKSPACES, parseInviteForm,
  pickWorkspace, sectionAfterSwitch, workspaceError,
} from './workspaces';

const W = (id: string, role: 'admin' | 'member' | 'viewer' = 'admin') => ({ id, name: id, role });

describe('pickWorkspace : quel espace ouvrir', () => {
  const mine = [W('a'), W('b', 'member'), W('c', 'viewer')];
  it('prend celui que la personne a choisi quand il figure parmi les siens', () => {
    expect(pickWorkspace(mine, 'b')).toEqual(W('b', 'member'));
    expect(pickWorkspace(mine, 'c')?.role).toBe('viewer');
  });
  it('sans choix, ou avec un choix périmé, forgé ou vide : le plus ancien, jamais un espace étranger', () => {
    for (const bad of [undefined, null, '', 'zzz', 'a OR 1=1', '../b', 'B']) expect(pickWorkspace(mine, bad)?.id, String(bad)).toBe('a');
  });
  it('rien à ouvrir si la personne n’a aucun espace', () => {
    expect(pickWorkspace([], 'a')).toBeNull();
  });
});

describe('sectionAfterSwitch : où aller après avoir changé d’espace', () => {
  it('reste dans la même section, sans le détail qui n’existe pas dans l’autre espace', () => {
    expect(sectionAfterSwitch('/app/inbox')).toBe('/app/inbox');
    expect(sectionAfterSwitch('/app/inbox?c=c5')).toBe('/app/inbox');
    expect(sectionAfterSwitch('/app/canaux/connecter/abc')).toBe('/app/canaux');
    expect(sectionAfterSwitch('/app/reglages')).toBe('/app/reglages');
    expect(sectionAfterSwitch('/app/connaissances')).toBe('/app/connaissances');
  });
  it('une valeur inconnue, vide ou hostile mène au calendrier', () => {
    for (const bad of [undefined, null, '', '/', '/app', '/app/', '/app/facturation', '/admin', 'https://evil.example/app/inbox', '//evil.example', '/app/../admin', '/app/__proto__']) {
      expect(sectionAfterSwitch(bad), String(bad)).toBe('/app/calendrier');
    }
  });
});

describe('droits', () => {
  it('on gère l’équipe, le nom et la suppression d’un espace dont on est administrateur', () => {
    expect(canManageWorkspace('admin')).toBe(true);
    expect(canManageWorkspace('member')).toBe(false);
    expect(canManageWorkspace('viewer')).toBe(false);
  });
  it('on crée un espace si l’on en administre au moins un, ou si l’on n’en a aucun', () => {
    expect(canCreateWorkspace([])).toBe(true);
    expect(canCreateWorkspace([W('a', 'viewer'), W('b', 'admin')])).toBe(true);
    expect(canCreateWorkspace([W('a', 'member'), W('b', 'viewer')])).toBe(false);
  });
  it('compte les administrateurs', () => {
    expect(adminCount([{ role: 'admin' }, { role: 'member' }, { role: 'admin' }])).toBe(2);
    expect(adminCount([])).toBe(0);
  });
  it('ne reconnaît que les trois rôles', () => {
    expect(['admin', 'member', 'viewer'].every(isOrgRole)).toBe(true);
    for (const bad of ['owner', 'ADMIN', '', null, undefined, 3, {}]) expect(isOrgRole(bad)).toBe(false);
  });
});

describe('workspaceError : les codes de la base en messages', () => {
  it.each([
    ['last_admin', 'app.workspace.errors.lastAdmin'],
    ['not_admin', 'app.workspace.errors.notAdmin'],
    ['workspace_limit', 'app.workspace.errors.limit'],
    ['already_member', 'app.workspace.errors.alreadyMember'],
    ['invitation_limit', 'app.workspace.errors.invitationLimit'],
    ['invitation_invalid', 'app.workspace.errors.invitationInvalid'],
    ['has_channels', 'app.workspace.errors.hasChannels'],
    ['has_queued_posts', 'app.workspace.errors.hasQueuedPosts'],
    ['last_workspace', 'app.workspace.errors.lastWorkspace'],
    ['forbidden', 'app.workspace.errors.forbidden'],
    ['new row violates row-level security policy for table "memberships"', 'app.workspace.errors.forbidden'],
    ['invalid_name', 'app.settings.errNameLength'],
    ['invalid_email', 'auth.validation.emailInvalid'],
    ['account suspended', 'auth.errors.suspended'],
  ])('%s', (message, key) => {
    expect(workspaceError(message).key).toBe(key);
  });
  it('donne les plafonds aux messages qui les citent, et un message générique sinon', () => {
    expect(workspaceError('workspace_limit').params).toEqual({ max: MAX_WORKSPACES });
    expect(workspaceError('invitation_limit').params).toEqual({ max: MAX_PENDING_INVITATIONS });
    for (const other of [undefined, null, '', 'connection reset', 'boom']) expect(workspaceError(other).key).toBe('app.errors.generic');
  });
});

describe('parseInviteForm', () => {
  it('nettoie l’adresse et prend « membre » par défaut', () => {
    expect(parseInviteForm('  Nora@Example.COM ', undefined)).toEqual({ ok: true, email: 'nora@example.com', role: 'member' });
    expect(parseInviteForm('a@b.co', 'viewer')).toEqual({ ok: true, email: 'a@b.co', role: 'viewer' });
    expect(parseInviteForm('a@b.co', '')).toMatchObject({ ok: true, role: 'member' });
  });
  it('refuse une adresse vide ou mal formée, et un rôle inconnu', () => {
    expect(parseInviteForm('', 'member')).toMatchObject({ ok: false, error: { key: 'auth.validation.emailRequired' } });
    expect(parseInviteForm('pas-une-adresse', 'member')).toMatchObject({ ok: false, error: { key: 'auth.validation.emailInvalid' } });
    expect(parseInviteForm('a@b.co', 'superadmin')).toMatchObject({ ok: false, error: { key: 'app.errors.generic' } });
  });
});

describe('liens d’invitation', () => {
  it('un jeton fait 64 caractères hexadécimaux', () => {
    expect(isInvitationToken('a'.repeat(64))).toBe(true);
    for (const bad of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'A'.repeat(64), `${'a'.repeat(63)}/`, null, undefined, 42]) expect(isInvitationToken(bad)).toBe(false);
  });
  it('le lien est une page de l’application', () => {
    expect(invitationPath('ab12')).toBe('/app/invitation/ab12');
    expect(invitationPath('a/b?c')).toBe('/app/invitation/a%2Fb%3Fc');
  });
});

describe('plafonds repris de la base', () => {
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations/20261102000001_workspaces.sql'), 'utf8');
  it('10 espaces créés, 50 invitations en attente, 7 jours : les mêmes chiffres que la migration', () => {
    expect(sql).toMatch(new RegExp(`created_by = v_user\\) >= ${MAX_WORKSPACES}\\b`));
    expect(sql).toMatch(new RegExp(`i\\.email <> v_email\\) >= ${MAX_PENDING_INVITATIONS}\\b`));
    expect(sql).toContain(`now() + interval '${INVITATION_DAYS} days'`);
  });
});
