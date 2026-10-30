'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';
import { cleanWorkspaceName, workspaceNameError } from '@/lib/workspace-name';
import { canCreateWorkspace, isInvitationToken, sectionAfterSwitch, WORKSPACE_COOKIE, WORKSPACE_COOKIE_MAX_AGE } from '@/lib/workspaces';

export interface WorkspaceFormState {
  error?: string;
  /** Le nom saisi, remis dans le champ : React vide le formulaire après chaque envoi, même refusé. */
  name?: string;
}

/** Mémorise l'espace choisi. Le cookie n'est qu'une préférence : `getSession` le compare à chaque requête aux appartenances réelles. */
async function remember(orgId: string): Promise<void> {
  (await cookies()).set(WORKSPACE_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: WORKSPACE_COOKIE_MAX_AGE,
    path: '/',
  });
}

/** Passe à un autre espace de travail. Un espace dont la personne n'est pas membre est ignoré : on reste où l'on est. */
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const target = session.ctx.workspaces.find((w) => w.id === String(formData.get('orgId') ?? ''));
  if (target) await remember(target.id);
  revalidatePath('/app', 'layout');
  redirect(sectionAfterSwitch(String(formData.get('from') ?? '')));
}

/** Crée un espace de travail (la personne en est l'administratrice), l'ouvre, puis lance la configuration des canaux. */
export async function createWorkspaceAction(_: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const { ctx } = session;
  const name = cleanWorkspaceName(formData.get('name'));
  const bad = workspaceNameError(name);
  if (bad) return { error: errorText(t, bad), name };
  if (!canCreateWorkspace(ctx.workspaces)) return { error: t('app.workspace.errors.notAdmin'), name };

  const repos = await getRepositories(ctx);
  const created = await repos.workspace.create(name, formData.get('copyMembers') === 'on' && ctx.org.role === 'admin');
  if (!created.ok) return { error: errorText(t, created.error), name };
  await remember(created.id);
  revalidatePath('/app', 'layout');
  redirect('/app/calendrier?onboarding=true');
}

/** Accepte l'invitation d'un lien (page `/app/invitation/<jeton>`) et ouvre l'espace rejoint. */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const token = String(formData.get('token') ?? '');
  if (!isInvitationToken(token)) redirect('/app/reglages');
  const repos = await getRepositories(session.ctx);
  const joined = await repos.workspace.acceptInvitation(token);
  if (!joined.ok) redirect(`/app/invitation/${token}`);
  await remember(joined.orgId);
  revalidatePath('/app', 'layout');
  redirect('/app/calendrier');
}

/** Accepte une invitation reçue (liste des Réglages) : l'adresse du compte figure sur l'invitation, pas besoin du lien. */
export async function acceptReceivedInvitationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const repos = await getRepositories(session.ctx);
  const joined = await repos.workspace.acceptReceivedInvitation(String(formData.get('id') ?? ''));
  if (joined.ok) await remember(joined.orgId);
  revalidatePath('/app', 'layout');
  redirect(joined.ok ? '/app/calendrier' : '/app/reglages');
}

export async function declineReceivedInvitationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const repos = await getRepositories(session.ctx);
  await repos.workspace.declineReceivedInvitation(String(formData.get('id') ?? ''));
  revalidatePath('/app', 'layout');
  redirect('/app/reglages');
}
