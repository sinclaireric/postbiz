'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRepositories, getSession } from '@/lib/data';

export interface SettingsState { error?: string; saved?: boolean }

export async function renameOrganizationAction(_: SettingsState, formData: FormData): Promise<SettingsState> {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  if (session.ctx.org.role !== 'admin') return { error: 'Seul un administrateur peut renommer l’organisation.' };
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 120) return { error: 'Le nom doit faire entre 2 et 120 caractères.' };
  const repos = await getRepositories(session.ctx);
  const res = await repos.workspace.renameOrganization(name);
  if (!res.ok) return { error: res.error };
  revalidatePath('/app', 'layout');
  return { saved: true };
}
