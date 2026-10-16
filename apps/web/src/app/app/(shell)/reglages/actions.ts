'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';

export interface SettingsState { error?: string; saved?: boolean }

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
