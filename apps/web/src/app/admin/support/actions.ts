'use server';

import { revalidatePath } from 'next/cache';
import { getAdminAccess } from '@/lib/admin/data';
import { loadSupportConversation, markConversationRead, replyToConversation, setConversationStatus } from '@/lib/admin/support-data';
import type { AdminSupportActionResult, SupportStatus } from '@/lib/support/types';

// Actions de l'espace propriétaire. Une action est une adresse publique : chacune vérifie elle-même que l'appelant est le propriétaire
// (et la base le vérifie encore, dans chaque fonction `admin_support_*`).

const FORBIDDEN: AdminSupportActionResult = { ok: false, code: 'forbidden' };
const isAdmin = async () => (await getAdminAccess()).status === 'admin';

export async function replyAction(id: string, body: string): Promise<AdminSupportActionResult> {
  if (!(await isAdmin()) || typeof id !== 'string' || typeof body !== 'string') return FORBIDDEN;
  const result = await replyToConversation(id, body);
  if (result.ok) revalidatePath('/admin', 'layout');
  return result;
}

export async function setStatusAction(id: string, status: SupportStatus): Promise<AdminSupportActionResult> {
  if (!(await isAdmin()) || typeof id !== 'string') return FORBIDDEN;
  const result = await setConversationStatus(id, status);
  if (result.ok) revalidatePath('/admin', 'layout');
  return result;
}

/** Relit le fil (sondage régulier de la page ouverte). */
export async function refreshThreadAction(id: string): Promise<AdminSupportActionResult> {
  if (!(await isAdmin()) || typeof id !== 'string') return FORBIDDEN;
  try {
    const thread = await loadSupportConversation(id);
    return thread ? { ok: true, thread } : { ok: false, code: 'not_found' };
  } catch {
    return { ok: false, code: 'failed' };
  }
}

/** Le propriétaire regarde la conversation : ses messages sont lus, la pastille de l'en-tête se met à jour. */
export async function markReadAction(id: string): Promise<void> {
  if (!(await isAdmin()) || typeof id !== 'string') return;
  await markConversationRead(id);
  revalidatePath('/admin', 'layout');
}
