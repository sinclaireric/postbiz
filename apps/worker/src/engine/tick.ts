import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { WorkerDb, WorkerMessage, WorkerPost } from './db.ts';
import { processFirstComment } from './comments.ts';
import { processMessage } from './outbox.ts';
import { processPost } from './posts.ts';

type Row = Record<string, any>;

export interface TickStats {
  swept: { posts_unknown: number; messages_failed: number; comments_unknown: number };
  posts: number;
  messages: number;
  comments: number;
}

/**
 * Un passage du worker : balaie le travail abandonné, réclame les publications dues, les réponses en file et les premiers
 * commentaires des publications déjà parties, puis les traite. Le verrou (claim_*) garantit qu'un élément n'est traité que par un seul worker.
 */
export async function tick(
  deps: { supabase: SupabaseClient; db: WorkerDb; providers: ProviderRegistry },
  limits: { posts: number; messages: number; comments?: number },
  log: (msg: string, extra?: unknown) => void = () => {}
): Promise<TickStats> {
  const { supabase, db, providers } = deps;

  const { data: swept, error: sweepError } = await supabase.rpc('sweep_stale_work');
  if (sweepError) throw new Error(`sweep_stale_work : ${sweepError.message}`);
  if (swept?.posts_unknown || swept?.messages_failed || swept?.comments_unknown) log('travail abandonné balayé', swept);

  const { data: posts, error: postsError } = await supabase.rpc('claim_due_posts', { p_limit: limits.posts, p_lock_seconds: 1800 });
  if (postsError) throw new Error(`claim_due_posts : ${postsError.message}`);
  const { data: messages, error: messagesError } = await supabase.rpc('claim_outbound_messages', { p_limit: limits.messages, p_lock_seconds: 120 });
  if (messagesError) throw new Error(`claim_outbound_messages : ${messagesError.message}`);

  const { data: comments, error: commentsError } = await supabase.rpc('claim_first_comments', { p_limit: limits.comments ?? 10, p_lock_seconds: 300 });
  if (commentsError) throw new Error(`claim_first_comments : ${commentsError.message}`);

  const toWorkerPost = (p: Row): WorkerPost => ({
    id: p.id, orgId: p.org_id, integrationId: p.integration_id, content: p.content, media: p.media ?? [], settings: p.settings ?? {}, createdBy: p.created_by,
    releaseId: p.release_id ?? null, firstComment: p.first_comment ?? null,
  });
  const claimedPosts: WorkerPost[] = ((posts ?? []) as Row[]).map(toWorkerPost);
  const claimedComments: WorkerPost[] = ((comments ?? []) as Row[]).map(toWorkerPost);
  const claimedMessages: WorkerMessage[] = ((messages ?? []) as Row[]).map((m) => ({
    id: m.id, orgId: m.org_id, conversationId: m.conversation_id, body: m.body, sentBy: m.sent_by,
  }));

  const results = await Promise.allSettled([
    ...claimedPosts.map((p) => processPost({ db, providers }, p).then((o) => log(`publication ${o.postId} : ${o.result}`, o.message))),
    ...claimedMessages.map((m) => processMessage({ db }, m).then((o) => log(`réponse ${o.messageId} : ${o.result}`, o.message))),
    ...claimedComments.map((p) => processFirstComment({ db, providers }, p).then((o) => log(`premier commentaire ${o.postId} : ${o.result}`, o.message))),
  ]);
  for (const r of results) if (r.status === 'rejected') log('erreur non gérée', String(r.reason));

  return {
    swept: { posts_unknown: swept?.posts_unknown ?? 0, messages_failed: swept?.messages_failed ?? 0, comments_unknown: swept?.comments_unknown ?? 0 },
    posts: claimedPosts.length,
    messages: claimedMessages.length,
    comments: claimedComments.length,
  };
}
