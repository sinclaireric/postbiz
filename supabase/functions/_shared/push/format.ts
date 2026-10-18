// Mise en forme des notifications push (API Expo), sans dépendance à Deno ni à Supabase : testable telle quelle.

/** Message de l'API Expo Push (https://docs.expo.dev/push-notifications/sending-notifications/). */
export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  /** Canal Android créé par apps/mobile/lib/push.ts. */
  channelId: 'default';
}

export interface PushContent {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushToken {
  userId: string;
  token: string;
}

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Limite de l'API : 100 messages par requête. */
export const EXPO_BATCH_SIZE = 100;

const BODY_MAX = 140;
const TITLE_MAX = 60;
/** Expo plafonne la charge utile à 4 Ko ; on reste largement en dessous (data + titre + corps). */
const DATA_MAX_BYTES = 1500;

/** Un jeton Expo ressemble à ExponentPushToken[xxxx] (ou ExpoPushToken[xxxx]). Les jetons « web » n'en sont pas. */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]\s]+\]$/.test(token);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Espaces et retours à la ligne repliés, coupé proprement avec une ellipse. */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------- lignes de la table notifications

export interface NotificationRow {
  id?: string;
  user_id?: string;
  org_id?: string | null;
  type?: string;
  title?: string;
  body?: string | null;
  data?: unknown;
}

/**
 * Charge `data` envoyée à l'application. L'application ouvre /conversation/<id> si `conversation_id` est une chaîne.
 * Le worker écrit `conversationId` (camelCase) dans notifications.data : on le normalise ici.
 * Seules les valeurs scalaires sont conservées (la charge est limitée à 4 Ko).
 */
export function notificationData(row: NotificationRow): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const src = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') data[k] = v;
  }
  const conversationId = asString(src.conversation_id) ?? asString(src.conversationId);
  if (conversationId) data.conversation_id = conversationId;
  delete data.conversationId;
  if (row.id) data.notification_id = row.id;
  if (row.type) data.type = row.type;
  if (row.org_id) data.org_id = row.org_id;
  // Charge trop volumineuse : on ne garde que ce dont l'application a besoin pour router.
  if (new TextEncoder().encode(JSON.stringify(data)).length > DATA_MAX_BYTES) {
    return conversationId ? { conversation_id: conversationId } : {};
  }
  return data;
}

/** Null si la ligne n'a pas de quoi être affichée (pas de titre). */
export function contentForNotification(row: NotificationRow): PushContent | null {
  const title = asString(row.title);
  if (!title) return null;
  return {
    title: truncate(title, TITLE_MAX),
    body: truncate(asString(row.body) ?? '', BODY_MAX),
    data: notificationData(row),
  };
}

// ---------------------------------------------------------------- messages entrants

export interface InboundMessageRow {
  id?: string;
  conversation_id?: string;
  org_id?: string;
  body?: string | null;
  attachments?: unknown;
  /** Posé par le trigger (qui n'envoie pas le détail des pièces jointes). */
  has_attachments?: boolean;
}

export interface ConversationContext {
  id: string;
  orgId: string;
  kind: 'dm' | 'comment_thread';
  contactName: string | null;
  contactUsername: string | null;
}

function hasAttachments(a: unknown): boolean {
  return Array.isArray(a) && a.length > 0;
}

export function contentForInboundMessage(msg: InboundMessageRow, conv: ConversationContext): PushContent {
  const who = asString(conv.contactName) ?? (asString(conv.contactUsername) ? `@${asString(conv.contactUsername)!.replace(/^@/, '')}` : null);
  const comment = conv.kind === 'comment_thread';
  const title = who ? (comment ? `${who} a commenté` : who) : comment ? 'Nouveau commentaire' : 'Nouveau message';
  const text = asString(msg.body);
  const body = text ? truncate(text, BODY_MAX) : msg.has_attachments === true || hasAttachments(msg.attachments) ? 'Pièce jointe' : 'Nouveau message';
  const data: Record<string, unknown> = { type: 'inbox_message', conversation_id: conv.id, org_id: conv.orgId };
  if (msg.id) data.message_id = msg.id;
  return { title: truncate(title, TITLE_MAX), body, data };
}

/**
 * Qui prévenir d'un message entrant : l'agent assigné s'il y en a un (et s'il peut encore répondre),
 * sinon tous les administrateurs et membres de l'organisation (les lecteurs ne répondent pas).
 */
export function messageRecipients(assigneeId: string | null | undefined, responderIds: readonly string[]): string[] {
  const unique = [...new Set(responderIds)];
  if (assigneeId && unique.includes(assigneeId)) return [assigneeId];
  return unique;
}

// ---------------------------------------------------------------- assemblage

/**
 * Un message Expo par jeton valide. Les jetons invalides (web, malformés) sont ignorés, les doublons aussi
 * (un même jeton ne doit pas recevoir deux fois la notification).
 */
export function buildExpoMessages(content: PushContent, tokens: readonly PushToken[]): ExpoMessage[] {
  const seen = new Set<string>();
  const out: ExpoMessage[] = [];
  for (const t of tokens) {
    if (!isExpoPushToken(t.token) || seen.has(t.token)) continue;
    seen.add(t.token);
    out.push({ to: t.token, title: content.title, body: content.body, data: content.data, sound: 'default', priority: 'high', channelId: 'default' });
  }
  return out;
}
