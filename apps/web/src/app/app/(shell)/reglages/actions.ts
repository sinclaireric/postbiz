'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText, GENERIC_ERROR } from '@/lib/form-error';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { purgeWorkspaceFilesAsService } from '@/lib/workspace-storage';
import { cleanWorkspaceName } from '@/lib/workspace-name';
import { canManageWorkspace, invitationPath, isOrgRole, parseInviteForm, WORKSPACE_COOKIE } from '@/lib/workspaces';

export interface SettingsState { error?: string; saved?: boolean }
export interface MemberState { error?: string; done?: boolean }
export interface InviteState {
  error?: string;
  /** Le lien à transmettre : il n'est montré qu'ici, une seule fois. */
  link?: string;
  email?: string;
}
export interface DeleteState { error?: string }

export async function renameOrganizationAction(_: SettingsState, formData: FormData): Promise<SettingsState> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  if (session.ctx.org.role !== 'admin') return { error: t('app.settings.errRename') };
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 120) return { error: t('app.settings.errNameLength') };
  const repos = await getRepositories(session.ctx);
  const res = await repos.workspace.renameOrganization(name);
  if (!res.ok) return { error: res.error ? errorText(t, res.error) : t('app.errors.generic') };
  revalidatePath('/app', 'layout');
  return { saved: true };
}

/** Changer le rôle d'un membre (`intent=role`) ou le retirer de l'espace (`intent=remove`) ; avec son propre identifiant, c'est quitter l'espace. */
export async function memberAction(_: MemberState, formData: FormData): Promise<MemberState> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const userId = String(formData.get('userId') ?? '');
  if (!userId || userId.length > 64) return { error: t('app.errors.generic') };
  const repos = await getRepositories(ctx);

  if (formData.get('intent') === 'remove') {
    const res = await repos.workspace.removeMember(userId);
    if (!res.ok) return { error: errorText(t, res.error ?? GENERIC_ERROR) };
    revalidatePath('/app', 'layout');
    // Quitter l'espace où l'on est : on n'y a plus accès, la page suivante ouvre un autre espace.
    if (userId === ctx.user.id) redirect('/app/reglages');
    return { done: true };
  }

  const role = formData.get('role');
  if (!isOrgRole(role)) return { error: t('app.errors.generic') };
  const res = await repos.workspace.setMemberRole(userId, role);
  if (!res.ok) return { error: errorText(t, res.error ?? GENERIC_ERROR) };
  revalidatePath('/app', 'layout');
  return { done: true };
}

/** Adresse du site telle que la voit la personne : en démo, celle du serveur qui répond (le port change) ; sinon l'adresse publique configurée. */
async function siteOrigin(): Promise<string> {
  if (!isDemo) return siteUrl;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  return host ? `${proto}://${host}` : siteUrl;
}

/** Invite une adresse : rend le lien d'invitation (valable 7 jours, à usage unique) que l'administrateur transmet lui-même. */
export async function inviteMemberAction(_: InviteState, formData: FormData): Promise<InviteState> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  if (!canManageWorkspace(ctx.org.role)) return { error: t('app.workspace.errors.forbidden') };
  const input = parseInviteForm(formData.get('email'), formData.get('role'));
  if (!input.ok) return { error: errorText(t, input.error) };
  const repos = await getRepositories(ctx);
  const res = await repos.workspace.invite(input.email, input.role);
  if (!res.ok) return { error: errorText(t, res.error), email: input.email };
  revalidatePath('/app/reglages');
  return { link: `${await siteOrigin()}${invitationPath(res.token)}`, email: input.email };
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const repos = await getRepositories(session.ctx);
  await repos.workspace.revokeInvitation(String(formData.get('id') ?? ''));
  revalidatePath('/app/reglages');
}

/**
 * Supprime l'espace courant. Il faut en saisir le nom ; la base refuse s'il reste des canaux connectés ou des publications en file, ou si c'est le dernier
 * espace de la personne. Ses fichiers du stockage sont retirés ensuite (avec la clé de service, si le serveur l'a).
 */
export async function deleteWorkspaceAction(_: DeleteState, formData: FormData): Promise<DeleteState> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  if (!canManageWorkspace(ctx.org.role)) return { error: t('app.workspace.errors.forbidden') };
  if (cleanWorkspaceName(formData.get('confirm')) !== cleanWorkspaceName(ctx.org.name)) return { error: t('app.workspace.errors.nameMismatch') };

  const repos = await getRepositories(ctx);
  const res = await repos.workspace.remove();
  if (!res.ok) return { error: errorText(t, res.error ?? GENERIC_ERROR) };
  if (ctx.mode === 'supabase') {
    const purged = await purgeWorkspaceFilesAsService(ctx.org.id).catch(() => ({ removed: 0, failed: true }));
    if (purged?.failed) console.error(`[workspace] des fichiers de l’espace ${ctx.org.id} n’ont pas pu être retirés du stockage`);
  }
  (await cookies()).delete(WORKSPACE_COOKIE);
  revalidatePath('/app', 'layout');
  redirect('/app/reglages');
}
