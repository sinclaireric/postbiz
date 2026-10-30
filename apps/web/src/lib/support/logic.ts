import { SUPPORT_FILTERS, type AdminSupportConversation, type AdminSupportRow, type AdminSupportSummary, type AdminSupportThread, type SupportAuthor, type SupportErrorCode, type SupportFilter, type SupportListQuery, type SupportMessage, type SupportStatus, type SupportThread } from './types';

/** Limites du chat : les mêmes que dans la base (migration `…_support_chat.sql`), qui reste l'autorité. */
export const SUPPORT_USER_MAX = 2_000;
export const SUPPORT_REPLY_MAX = 4_000;
/** 5 messages par minute, 20 messages de la personne sans réponse du support. */
export const SUPPORT_BURST = { max: 5, windowMs: 60_000 } as const;
export const SUPPORT_MAX_UNANSWERED = 20;
/** Messages chargés d'une conversation. */
export const SUPPORT_THREAD_LIMIT = 200;
export const SUPPORT_PAGE_SIZE = 25;

const codePoints = (s: string): number => [...s].length;

/**
 * Le texte d'un message tel que la base le garde (`support_clean_body`) : fins de ligne unifiées, caractères de contrôle retirés, ainsi que les marques de direction
 * (U+202A–202E, U+2066–2069) qui font passer un texte pour un autre à l'écran, trois sauts de ligne ou plus ramenés à deux, blancs de début et de fin retirés.
 */
export function cleanSupportBody(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \n\t]+|[ \n\t]+$/g, '');
}

/** Faute du texte (déjà nettoyé) : vide ou trop long, ou null s'il peut partir. Les caractères sont comptés comme la base, par point de code. */
export function validateSupportBody(clean: string, max: number): SupportErrorCode | null {
  if (clean.length === 0) return 'invalid_message';
  return codePoints(clean) > max ? 'message_too_long' : null;
}

const CODES: readonly SupportErrorCode[] = ['invalid_message', 'message_too_long', 'rate_limited', 'too_many_unanswered'];

/** Code d'erreur d'une réponse de la base : la fonction lève `rate_limited`, `message_too_long`… ; tout le reste (réseau, droits, compte suspendu) est `failed`. */
export function supportErrorCode(error: { message?: string } | null | undefined): SupportErrorCode {
  const message = error?.message ?? '';
  return CODES.find((c) => message.includes(c)) ?? 'failed';
}

/** Les mêmes limites que `support_send`, pour le mode démo : `history` est le fil de la personne, `now` en millisecondes. */
export function checkSendLimits(history: readonly Pick<SupportMessage, 'author' | 'createdAt'>[], now: number): SupportErrorCode | null {
  const recent = history.filter((m) => m.author === 'user' && now - Date.parse(m.createdAt) < SUPPORT_BURST.windowMs).length;
  if (recent >= SUPPORT_BURST.max) return 'rate_limited';
  let unanswered = 0;
  for (let i = history.length - 1; i >= 0 && history[i]!.author === 'user'; i--) unanswered++;
  return unanswered >= SUPPORT_MAX_UNANSWERED ? 'too_many_unanswered' : null;
}

// ---------------------------------------------------------------- lecture des lignes de la base

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const author = (v: unknown): SupportAuthor => (v === 'support' ? 'support' : 'user');
const status = (v: unknown): SupportStatus => (v === 'resolved' ? 'resolved' : 'open');

/** Ligne de `support_messages` (ou élément de `admin_support_thread().messages`) ; null si elle n'a pas d'identifiant ou de texte. */
export function parseMessage(raw: unknown): SupportMessage | null {
  const r = obj(raw);
  const id = str(r.id);
  const body = str(r.body);
  if (!id || body === null) return null;
  return { id, author: author(r.author), body, createdAt: str(r.created_at) ?? '' };
}

/** Ajoute des messages à un fil sans doublon (par identifiant), du plus ancien au plus récent : un envoi puis une relecture ne montrent pas deux fois le même message. */
export function mergeMessages(current: readonly SupportMessage[], incoming: readonly SupportMessage[]): SupportMessage[] {
  const byId = new Map<string, SupportMessage>();
  for (const m of [...current, ...incoming]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Conversation de la personne (ligne de `support_conversations`) et ses messages (lignes de `support_messages`, dans n'importe quel ordre). */
export function parseThread(conversation: unknown, messages: unknown[]): SupportThread {
  const c = obj(conversation);
  const id = str(c.id);
  if (!id) return { conversationId: null, status: 'open', unread: 0, messages: [] };
  return {
    conversationId: id,
    status: status(c.status),
    unread: num(c.user_unread),
    messages: mergeMessages([], messages.flatMap((m) => parseMessage(m) ?? [])),
  };
}

export const parseSummary = (raw: unknown): AdminSupportSummary => {
  const r = obj(raw);
  return { all: num(r.all), open: num(r.open), resolved: num(r.resolved), unread: num(r.unread), unreadMessages: num(r.unread_messages) };
};

/** Ligne de `admin_support_conversations()`. */
export function parseSupportRow(raw: unknown): AdminSupportRow {
  const r = obj(raw);
  return {
    id: str(r.id) ?? '',
    userId: str(r.user_id) ?? '',
    name: str(r.display_name),
    email: str(r.email) ?? '',
    orgName: str(r.org_name),
    status: status(r.status),
    supportUnread: num(r.support_unread),
    userUnread: num(r.user_unread),
    messageCount: num(r.message_count),
    lastMessageAt: str(r.last_message_at) ?? '',
    lastAuthor: author(r.last_author),
    lastBody: str(r.last_body) ?? '',
    createdAt: str(r.created_at) ?? '',
  };
}

function parseConversation(raw: unknown): AdminSupportConversation | null {
  const c = obj(raw);
  const id = str(c.id);
  if (!id) return null;
  return {
    id, userId: str(c.user_id) ?? '', name: str(c.display_name), email: str(c.email) ?? '', orgName: str(c.org_name), status: status(c.status),
    supportUnread: num(c.support_unread), userUnread: num(c.user_unread), createdAt: str(c.created_at) ?? '', lastMessageAt: str(c.last_message_at) ?? '', resolvedAt: str(c.resolved_at),
  };
}

/** Réponse de `admin_support_thread()` ; null si la conversation n'existe pas. */
export function parseAdminThread(raw: unknown): AdminSupportThread | null {
  const r = obj(raw);
  const conversation = parseConversation(r.conversation);
  if (!conversation) return null;
  return { conversation, messages: mergeMessages([], (Array.isArray(r.messages) ? r.messages : []).flatMap((m) => parseMessage(m) ?? [])), truncated: r.truncated === true };
}

// ---------------------------------------------------------------- adresses de l'espace propriétaire

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';

export function parseSupportQuery(params: Record<string, string | string[] | undefined>): SupportListQuery {
  const filter = first(params.filtre);
  const page = Number.parseInt(first(params.page), 10);
  return {
    filter: (SUPPORT_FILTERS as readonly string[]).includes(filter) ? (filter as SupportFilter) : 'all',
    search: first(params.q).replace(/\s+/g, ' ').trim().slice(0, 100),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

/** Adresse de la liste avec ses filtres ; les valeurs par défaut sont omises. */
export function supportHref(base: string, q: Partial<SupportListQuery>): string {
  const p = new URLSearchParams();
  if (q.filter && q.filter !== 'all') p.set('filtre', q.filter);
  if (q.search) p.set('q', q.search);
  if (q.page && q.page > 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Une conversation du support (l'identifiant vient de l'adresse : on ne l'envoie à la base que s'il a la forme d'un UUID). */
export const isConversationId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Où mène une notification du chat : la personne va au chat, le propriétaire à la conversation. Null pour les autres types. */
export function supportNotificationHref(type: string, data: Record<string, unknown> | null | undefined): string | null {
  if (type === 'support_reply') return '/app/support';
  const id = data?.support_conversation_id;
  return type === 'support_message' && typeof id === 'string' && isConversationId(id) ? `/admin/support/${id}` : null;
}
