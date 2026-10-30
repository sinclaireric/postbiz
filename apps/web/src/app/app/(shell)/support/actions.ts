'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/data';
import { loadSupportThread, loadSupportUnread, markSupportRead, sendSupportMessage } from '@/lib/support/data';
import type { SupportLoadResult, SupportSendResult } from '@/lib/support/types';

// Actions du chat de support. Chacune relit la session : une action est une adresse publique, elle ne se fie pas à la page qui l'appelle.

/** Envoie un message au support ; rend le fil à jour, ou le code de l'erreur. */
export async function sendSupportMessageAction(body: string): Promise<SupportSendResult> {
  const session = await getSession();
  if (session.status !== 'ready' || typeof body !== 'string') return { ok: false, code: 'failed' };
  return sendSupportMessage(session.ctx, body);
}

/** Relit le fil (sondage régulier, ou événement Realtime). */
export async function refreshSupportAction(): Promise<SupportLoadResult> {
  const session = await getSession();
  if (session.status !== 'ready') return { ok: false };
  try {
    return { ok: true, thread: await loadSupportThread(session.ctx) };
  } catch {
    return { ok: false };
  }
}

/** La personne regarde la conversation : ses réponses sont lues. La pastille de la bulle et la cloche (dans la mise en page) sont recalculées. */
export async function markSupportReadAction(): Promise<void> {
  const session = await getSession();
  if (session.status !== 'ready') return;
  await markSupportRead(session.ctx);
  revalidatePath('/app', 'layout');
}

/** Réponses non lues, pour la pastille de la bulle (sondage de repli quand le temps réel n'est pas disponible). */
export async function supportUnreadAction(): Promise<number | null> {
  const session = await getSession();
  if (session.status !== 'ready') return null;
  try {
    return await loadSupportUnread(session.ctx);
  } catch {
    return null;
  }
}
