import { createClient } from '@/lib/supabase/server';
import type { AppContext } from '@/lib/data/types';
import { demoMarkRead, demoSend, demoThread, demoUnread } from './demo';
import { SUPPORT_THREAD_LIMIT, SUPPORT_USER_MAX, cleanSupportBody, parseThread, supportErrorCode, validateSupportBody } from './logic';
import { EMPTY_THREAD, type SupportSendResult, type SupportThread } from './types';

// Le chat de support côté utilisateur. Lectures : les tables, sous la RLS (la conversation de la personne seulement, jamais une adresse e-mail).
// Écritures : les fonctions `support_send` et `support_mark_read`, seules à pouvoir écrire (limite de débit, taille et nettoyage du texte dans la base).
// En démonstration (sans Supabase) : un fil en mémoire du serveur, partagé avec l'espace propriétaire (lib/support/demo.ts).

/** La conversation de la personne connectée, avec ses derniers messages. Vide tant qu'elle n'a rien écrit. */
export async function loadSupportThread(ctx: AppContext): Promise<SupportThread> {
  if (ctx.mode === 'demo') return demoThread(ctx.user.id);
  const supabase = await createClient();
  const { data: conversation } = await supabase.from('support_conversations').select('id, status, user_unread').eq('user_id', ctx.user.id).maybeSingle();
  if (!conversation) return EMPTY_THREAD;
  const { data: messages } = await supabase
    .from('support_messages')
    .select('id, author, body, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(SUPPORT_THREAD_LIMIT);
  return parseThread(conversation, messages ?? []);
}

/** Réponses du support non lues, pour la pastille de la bulle. 0 en cas d'erreur : la bulle reste sans pastille plutôt que de casser la page. */
export async function loadSupportUnread(ctx: AppContext): Promise<number> {
  if (ctx.mode === 'demo') return demoUnread(ctx.user.id);
  const supabase = await createClient();
  const { data } = await supabase.from('support_conversations').select('user_unread').eq('user_id', ctx.user.id).maybeSingle();
  return typeof data?.user_unread === 'number' ? data.user_unread : 0;
}

/** Envoie un message au support et rend le fil à jour. Le texte est nettoyé ici comme dans la base ; la base reste l'autorité (limites, droits). */
export async function sendSupportMessage(ctx: AppContext, body: string): Promise<SupportSendResult> {
  const clean = cleanSupportBody(body);
  const invalid = validateSupportBody(clean, SUPPORT_USER_MAX);
  if (invalid) return { ok: false, code: invalid };

  if (ctx.mode === 'demo') {
    const sent = demoSend(ctx.user, ctx.org.name, clean);
    return sent.ok ? { ok: true, thread: demoThread(ctx.user.id) } : { ok: false, code: sent.code, thread: demoThread(ctx.user.id) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('support_send', { p_body: clean, p_org: ctx.org.id });
  const thread = await loadSupportThread(ctx);
  return error ? { ok: false, code: supportErrorCode(error), thread } : { ok: true, thread };
}

/** La personne a lu les réponses : son compteur repasse à zéro, et ses notifications de réponse sont lues. */
export async function markSupportRead(ctx: AppContext): Promise<void> {
  if (ctx.mode === 'demo') return demoMarkRead(ctx.user.id);
  const supabase = await createClient();
  await supabase.rpc('support_mark_read');
}
