'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRepositories, getSession } from '@/lib/data';
import type { ConversationStatus } from '@/lib/inbox/types';

export interface ReplyState {
  error?: string;
  /** Change à chaque envoi réussi : sert à vider le champ de saisie. */
  sentAt?: number;
}

async function requireWriter() {
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  if (session.ctx.org.role === 'viewer') return { error: 'Votre rôle (lecteur) ne permet pas de répondre.' } as const;
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
  if (!res.ok) return { error: res.error };
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
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return { error: 'Écrivez une note.' };
  if (body.length > 2000) return { error: 'La note est trop longue.' };
  const repos = await getRepositories(auth.ctx);
  const res = await repos.inbox.addNote(String(formData.get('conversationId') ?? ''), body);
  if (!res.ok) return { error: res.error };
  revalidatePath('/app/inbox');
  return { sentAt: Date.now() };
}
