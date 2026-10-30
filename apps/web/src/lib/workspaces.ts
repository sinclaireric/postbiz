import type { MessageKey } from '@/i18n/types';
import { normalizeEmail, validateEmail } from '@/lib/auth-validation';
import type { OrgRole, WorkspaceSummary } from '@/lib/data/types';
import { GENERIC_ERROR, type FormError } from '@/lib/form-error';

// Espaces de travail : une personne peut en avoir plusieurs (une organisation chacun) et choisit celui qu'elle ouvre.
// Le choix est mémorisé dans un cookie, mais il n'est jamais cru sur parole : on le compare toujours à la liste des appartenances de la personne.

/** Cookie de l'espace courant (le `showorg` de Postiz). Lisible par le serveur seulement. */
export const WORKSPACE_COOKIE = 'postbiz_org';
export const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** En-tête par lequel l'application mobile (qui n'a pas de cookie) désigne l'espace voulu ; vérifié comme le cookie. */
export const WORKSPACE_HEADER = 'x-postbiz-org';

/** Plafonds appliqués par la base (`create_organization`, `invite_to_workspace`) ; repris ici pour les messages. */
export const MAX_WORKSPACES = 10;
export const MAX_PENDING_INVITATIONS = 50;
export const INVITATION_DAYS = 7;

export const ORG_ROLES: readonly OrgRole[] = ['admin', 'member', 'viewer'];
export const isOrgRole = (value: unknown): value is OrgRole => typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);

/**
 * L'espace à ouvrir : celui que la personne a choisi s'il figure parmi les siens, sinon le plus ancien. Une valeur absente, périmée
 * (espace quitté ou supprimé) ou forgée retombe donc sur un espace dont la personne est membre, jamais sur un autre.
 */
export function pickWorkspace<T extends { id: string }>(workspaces: readonly T[], preferredId: string | null | undefined): T | null {
  if (workspaces.length === 0) return null;
  return (preferredId ? workspaces.find((w) => w.id === preferredId) : undefined) ?? workspaces[0]!;
}

/** Les pages de l'application dont l'adresse commence par `/app/<section>` : après un changement d'espace, on reste dans la même section. */
const SECTIONS = ['calendrier', 'publications', 'inbox', 'medias', 'canaux', 'agent', 'analyses', 'connaissances', 'reglages'] as const;

/**
 * Où aller après avoir changé d'espace. La section reste la même, mais ni le détail (`?c=<conversation>`, `canaux/connecter/<id>`) ni ce qui
 * n'existe pas dans l'autre espace : on ne garde que la section, et seulement si elle est connue.
 */
export function sectionAfterSwitch(from: string | null | undefined): string {
  const section = String(from ?? '').split('?')[0]!.split('/')[2];
  return `/app/${(SECTIONS as readonly string[]).includes(section ?? '') ? section : 'calendrier'}`;
}

/** Peut-on gérer l'équipe, renommer ou supprimer cet espace ? Les administrateurs seulement (la base le vérifie de toute façon). */
export const canManageWorkspace = (role: OrgRole) => role === 'admin';

/** Les administrateurs de l'espace sont-ils au moins deux ? Sinon le seul administrateur ne peut ni partir ni changer de rôle. */
export const adminCount = (members: readonly { role: OrgRole }[]) => members.filter((m) => m.role === 'admin').length;

/** Une personne qui n'est que membre ou lecteur ailleurs ne peut pas créer d'espace : il faut administrer au moins un espace (ou n'en avoir aucun). */
export const canCreateWorkspace = (workspaces: readonly WorkspaceSummary[]) => workspaces.length === 0 || workspaces.some((w) => w.role === 'admin');

const DB_ERRORS: [code: string, error: FormError][] = [
  ['invalid_name', { key: 'app.settings.errNameLength' }],
  ['not_admin', { key: 'app.workspace.errors.notAdmin' }],
  ['workspace_limit', { key: 'app.workspace.errors.limit', params: { max: MAX_WORKSPACES } }],
  ['last_admin', { key: 'app.workspace.errors.lastAdmin' }],
  ['already_member', { key: 'app.workspace.errors.alreadyMember' }],
  ['invalid_email', { key: 'auth.validation.emailInvalid' }],
  ['invitation_limit', { key: 'app.workspace.errors.invitationLimit', params: { max: MAX_PENDING_INVITATIONS } }],
  ['invitation_invalid', { key: 'app.workspace.errors.invitationInvalid' }],
  ['has_channels', { key: 'app.workspace.errors.hasChannels' }],
  ['has_queued_posts', { key: 'app.workspace.errors.hasQueuedPosts' }],
  ['last_workspace', { key: 'app.workspace.errors.lastWorkspace' }],
  ['suspended', { key: 'auth.errors.suspended' }],
  ['forbidden', { key: 'app.workspace.errors.forbidden' }],
  ['row-level security', { key: 'app.workspace.errors.forbidden' }],
];

/** Un message d'erreur de la base (les fonctions d'espaces lèvent des codes lisibles) ramené à un message de formulaire traduisible. */
export function workspaceError(message: string | undefined | null): FormError {
  const text = message ?? '';
  return DB_ERRORS.find(([code]) => text.includes(code))?.[1] ?? GENERIC_ERROR;
}

export type InviteInput = { ok: true; email: string; role: OrgRole } | { ok: false; error: FormError };

/** Lit le formulaire d'invitation : une adresse valide, et un rôle connu (membre par défaut). */
export function parseInviteForm(emailValue: unknown, roleValue: unknown): InviteInput {
  const email = normalizeEmail(emailValue);
  const bad = validateEmail(email);
  if (bad) return { ok: false, error: bad };
  const role = roleValue === undefined || roleValue === null || roleValue === '' ? 'member' : roleValue;
  if (!isOrgRole(role)) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, email, role };
}

/** Message d'un rôle (« Administrateur », « Membre », « Lecteur »). */
export const roleKey = (role: OrgRole): MessageKey => `common.role.${role}`;
export const roleHelpKey = (role: OrgRole): MessageKey => `app.workspace.roleHelp.${role}`;

/** Lien d'invitation à transmettre : la page `/app/invitation/<jeton>` du site. */
export const invitationPath = (token: string) => `/app/invitation/${encodeURIComponent(token)}`;

/** Un jeton d'invitation est 64 caractères hexadécimaux : tout le reste est refusé avant d'interroger la base. */
export const isInvitationToken = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
