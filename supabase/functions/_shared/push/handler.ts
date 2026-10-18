// Logique de l'Edge Function `send-push`, isolée de Deno et de Supabase pour pouvoir être testée.
//
// Déclenchement : triggers Postgres (migration 20261019000001_push.sql) qui appellent la fonction via pg_net à chaque
// INSERT dans `notifications` et dans `messages` (direction 'in'), avec le format des « Database Webhooks » Supabase.
import {
  buildExpoMessages,
  contentForInboundMessage,
  contentForNotification,
  messageRecipients,
  type ConversationContext,
  type InboundMessageRow,
  type NotificationRow,
  type PushContent,
  type PushToken,
} from './format.ts';
import { sendExpoMessages, type SendDeps } from './sender.ts';

export interface PushDb {
  /** Null si la conversation n'existe plus. */
  getConversation(id: string): Promise<(ConversationContext & { assigneeId: string | null }) | null>;
  /** Administrateurs et membres de l'organisation (pas les lecteurs). */
  listResponderIds(orgId: string): Promise<string[]>;
  getTokens(userIds: string[]): Promise<PushToken[]>;
  deleteTokens(tokens: string[]): Promise<void>;
}

export interface PushConfig {
  /** Secret partagé avec les triggers (en-tête `x-push-secret`). Vide => la fonction refuse tout. */
  webhookSecret: string;
}

export interface PushOutcome {
  status: 'sent' | 'ignored';
  reason?: string;
  recipients: number;
  sent: number;
  removed: number;
  failed: number;
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const encoder = new TextEncoder();
async function secretsMatch(a: string, b: string): Promise<boolean> {
  // Comparaison en temps constant sur des empreintes de même longueur.
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

const ignored = (reason: string): PushOutcome => ({ status: 'ignored', reason, recipients: 0, sent: 0, removed: 0, failed: 0 });

async function deliver(content: PushContent, userIds: string[], db: PushDb, sendDeps: SendDeps): Promise<PushOutcome> {
  if (userIds.length === 0) return ignored('aucun destinataire');
  const messages = buildExpoMessages(content, await db.getTokens(userIds));
  if (messages.length === 0) return ignored('aucun jeton enregistré');
  const report = await sendExpoMessages(messages, sendDeps);
  if (report.deadTokens.length > 0) await db.deleteTokens(report.deadTokens);
  return { status: 'sent', recipients: messages.length, sent: report.sent, removed: report.deadTokens.length, failed: report.failed.length };
}

/** Traite un événement INSERT. Lève en cas d'erreur de base : l'appelant répond 500. */
export async function processPushEvent(event: any, db: PushDb, sendDeps: SendDeps): Promise<PushOutcome> {
  if (event?.type !== 'INSERT' || event?.schema !== 'public') return ignored('événement non géré');
  const record = event.record;
  if (!record || typeof record !== 'object') return ignored('enregistrement absent');

  if (event.table === 'notifications') {
    const row = record as NotificationRow;
    const content = contentForNotification(row);
    if (!content) return ignored('notification sans titre');
    if (typeof row.user_id !== 'string') return ignored('notification sans destinataire');
    return deliver(content, [row.user_id], db, sendDeps);
  }

  if (event.table === 'messages') {
    const msg = record as InboundMessageRow & { direction?: string };
    if (msg.direction !== 'in') return ignored('message sortant');
    if (typeof msg.conversation_id !== 'string') return ignored('message sans conversation');
    const conv = await db.getConversation(msg.conversation_id);
    if (!conv) return ignored('conversation introuvable');
    const userIds = messageRecipients(conv.assigneeId, await db.listResponderIds(conv.orgId));
    return deliver(contentForInboundMessage(msg, conv), userIds, db, sendDeps);
  }

  return ignored('table non gérée');
}

export async function handlePushWebhook(req: Request, cfg: PushConfig, db: PushDb, sendDeps: SendDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const provided = req.headers.get('x-push-secret') ?? '';
  if (!cfg.webhookSecret || !provided || !(await secretsMatch(provided, cfg.webhookSecret))) return json({ error: 'unauthorized' }, 401);

  let event: unknown;
  try {
    event = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  let outcome: PushOutcome;
  try {
    outcome = await processPushEvent(event, db, sendDeps);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  // Tout lot perdu après nouvelles tentatives => 502, visible dans les journaux de la fonction.
  return json(outcome, outcome.failed > 0 && outcome.sent === 0 ? 502 : 200);
}
