/** Qui a écrit un message : la personne qui contacte le support, ou l'équipe (le propriétaire de la plateforme). */
export type SupportAuthor = 'user' | 'support';
export type SupportStatus = 'open' | 'resolved';

export interface SupportMessage {
  id: string;
  author: SupportAuthor;
  /** Texte brut : jamais interprété (ni HTML, ni lien cliquable), affiché tel quel. */
  body: string;
  createdAt: string;
}

/** La conversation d'une personne avec le support. Sans message envoyé, elle n'existe pas encore (`conversationId` nul). */
export interface SupportThread {
  conversationId: string | null;
  status: SupportStatus;
  /** Réponses du support que la personne n'a pas encore lues. */
  unread: number;
  /** Du plus ancien au plus récent. */
  messages: SupportMessage[];
}

export const EMPTY_THREAD: SupportThread = { conversationId: null, status: 'open', unread: 0, messages: [] };

/** Codes d'erreur de l'envoi : ceux que lève la base (`support_send`), plus `failed` pour tout le reste. */
export type SupportErrorCode = 'invalid_message' | 'message_too_long' | 'rate_limited' | 'too_many_unanswered' | 'failed';

export type SupportSendResult = { ok: true; thread: SupportThread } | { ok: false; code: SupportErrorCode; thread?: SupportThread };
export type SupportLoadResult = { ok: true; thread: SupportThread } | { ok: false };

// ---------------------------------------------------------------- espace propriétaire

export const SUPPORT_FILTERS = ['all', 'unread', 'open', 'resolved'] as const;
export type SupportFilter = (typeof SUPPORT_FILTERS)[number];

export interface SupportListQuery {
  filter: SupportFilter;
  search: string;
  page: number;
}

/** Chiffres de l'en-tête de l'espace propriétaire. */
export interface AdminSupportSummary {
  all: number;
  open: number;
  resolved: number;
  /** Conversations avec au moins un message que le support n'a pas lu. */
  unread: number;
  unreadMessages: number;
}

export interface AdminSupportRow {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  orgName: string | null;
  status: SupportStatus;
  supportUnread: number;
  userUnread: number;
  messageCount: number;
  lastMessageAt: string;
  lastAuthor: SupportAuthor;
  lastBody: string;
  createdAt: string;
}

export interface AdminSupportConversation {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  orgName: string | null;
  status: SupportStatus;
  supportUnread: number;
  userUnread: number;
  createdAt: string;
  lastMessageAt: string;
  resolvedAt: string | null;
}

export interface AdminSupportThread {
  conversation: AdminSupportConversation;
  messages: SupportMessage[];
  /** Vrai quand la conversation a plus de messages que ceux chargés (les plus anciens ne sont pas montrés). */
  truncated: boolean;
}

export type AdminSupportActionResult = { ok: true; thread: AdminSupportThread } | { ok: false; code: SupportErrorCode | 'not_found' | 'forbidden' };
