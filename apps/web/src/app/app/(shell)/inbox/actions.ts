'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getT } from '@/i18n/server';
import { getRepositories, getSession } from '@/lib/data';
import { errorText } from '@/lib/form-error';
import { settleSuggestion } from '@/lib/inbox/suggest';
import type { ConversationStatus } from '@/lib/inbox/types';

export interface ReplyState {
  error?: string;
  /** Change à chaque envoi réussi : sert à vider le champ de saisie. */
  sentAt?: number;
}

async function requireWriter() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  if (session.ctx.org.role === 'viewer') {
    const t = await getT();
    return { error: t('app.inbox.viewerNoReply') } as const;
  }
  return { ctx: session.ctx } as const;
}

const STATUSES: ConversationStatus[] = ['open', 'pending', 'snoozed', 'closed'];

export async function sendReplyAction(_: ReplyState, formData: FormData): Promise<ReplyState> {
  const auth = await requireWriter();
  if ('error' in auth) return { error: auth.error };
  const conversationId = String(formData.get('conversationId') ?? '');
  const body = String(formData.get('body') ?? '');

  const repos = await getRepositories(auth.ctx);
  const res = await repos.inbox.sendReply(conversationId, body);
  if (!res.ok) return { error: res.error ? errorText(await getT(), res.error) : undefined };
  // La réponse partait d'une suggestion de l'IA : on garde ce qu'on en a fait (envoyée telle quelle, ou modifiée), pour mesurer sa qualité.
  const suggestionId = String(formData.get('suggestionId') ?? '');
  if (/^[\w-]{1,64}$/.test(suggestionId)) await settleSuggestion(repos, suggestionId, body);
  revalidatePath('/app/inbox');
  return { sentAt: Date.now() };
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const auth = await requireWriter();
  if ('error' in auth) return;
  const status = String(formData.get('status') ?? '') as ConversationStatus;
  if (!STATUSES.includes(status)) return;
  const repos = await getRepositories(auth.ctx);
  await repos.inbox.setStatus(String(formData.get('conversationId') ?? ''), status);
  revalidatePath('/app/inbox');
}

export async function addNoteAction(_: ReplyState, formData: FormData): Promise<ReplyState> {
  const auth = await requireWriter();
  if ('error' in auth) return { error: auth.error };
  const t = await getT();
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return { error: t('app.inbox.notes.empty') };
  if (body.length > 2000) return { error: t('app.inbox.notes.tooLong') };
  const repos = await getRepositories(auth.ctx);
  const res = await repos.inbox.addNote(String(formData.get('conversationId') ?? ''), body);
  if (!res.ok) return { error: res.error ? errorText(t, res.error) : undefined };
  revalidatePath('/app/inbox');
  return { sentAt: Date.now() };
}
