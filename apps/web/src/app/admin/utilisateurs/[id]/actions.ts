'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { cleanReason, isUserId, suspensionFailure } from '@/lib/admin/logic';
import type { Flash } from '@/lib/admin/types';
import { isDemo } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

/** Retour sur la fiche, avec le résultat dans `?ok=`. À appeler en dernier : `redirect` interrompt la fonction. */
function back(userId: string, flash: Flash): never {
  revalidatePath('/admin/utilisateurs');
  revalidatePath(`/admin/utilisateurs/${userId}`);
  redirect(`/admin/utilisateurs/${userId}?ok=${flash}`);
}

function targetOf(formData: FormData): string {
  const id = String(formData.get('user') ?? '');
  if (!isUserId(id)) notFound();
  return id;
}

/** Suspend un compte. Le propriétaire est revérifié ici (et par la base) : une action serveur est un point d'entrée comme un autre. */
export async function suspendUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = targetOf(formData);
  if (isDemo) back(userId, 'demo');
  if (userId === admin.id) back(userId, 'self');

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_suspend_user', { p_user: userId, p_reason: cleanReason(formData.get('reason')) });
  back(userId, error ? suspensionFailure(error.message) : 'suspended');
}

export async function restoreUserAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = targetOf(formData);
  if (isDemo) back(userId, 'demo');

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_restore_user', { p_user: userId });
  back(userId, error ? 'error' : 'restored');
}
