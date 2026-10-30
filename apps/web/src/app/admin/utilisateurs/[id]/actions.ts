'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { cleanReason, giftEnd, giftFailure, isUserId, parseGiftMonths, suspensionFailure } from '@/lib/admin/logic';
import { isPaidPlanId } from '@/lib/billing/plans';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Offre un abonnement à une organisation de l'utilisateur (propriétaire de la plateforme seulement : la base le revérifie). Jamais par-dessus un abonnement payé. */
export async function grantSubscriptionAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = targetOf(formData);
  const org = String(formData.get('org') ?? '');
  const plan = String(formData.get('plan') ?? '');
  const months = parseGiftMonths(formData.get('months'));
  if (!UUID.test(org) || !isPaidPlanId(plan) || months === null) back(userId, 'giftInvalid');
  if (isDemo) back(userId, 'demo');

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_grant_subscription', { p_org: org, p_plan: plan, p_until: giftEnd(months!).toISOString(), p_note: cleanReason(formData.get('note')) });
  back(userId, error ? giftFailure(error.message) : 'gifted');
}

/** Retire un abonnement offert (sans toucher à un abonnement payé). */
export async function revokeGiftAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = targetOf(formData);
  const org = String(formData.get('org') ?? '');
  if (!UUID.test(org)) back(userId, 'giftInvalid');
  if (isDemo) back(userId, 'demo');

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_revoke_gift', { p_org: org });
  back(userId, error ? 'error' : 'giftRevoked');
}
