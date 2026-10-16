import type { FormError } from '@/lib/form-error';
import type { Network } from '@/lib/networks';

export type NetworkId = Network['id'];
export type ConversationKind = 'dm' | 'comment_thread';
export type ConversationStatus = 'open' | 'pending' | 'snoozed' | 'closed';
export type DeliveryStatus = 'received' | 'queued' | 'sending' | 'sent' | 'failed';

export interface ConversationSummary {
  id: string;
  networkId: NetworkId;
  accountName: string; // nom de la Page / du compte connecté
  kind: ConversationKind;
  contactName: string;
  contactUsername: string | null;
  status: ConversationStatus;
  assigneeName: string | null;
  unreadCount: number;
  lastMessageAt: string; // ISO
  lastMessagePreview: string;
  replyWindowExpiresAt: string | null; // ISO, messages privés Meta uniquement
}

export interface MessageItem {
  id: string;
  direction: 'in' | 'out';
  body: string | null;
  attachments: { type: string; url?: string }[];
  sentByName: string | null;
  deliveryStatus: DeliveryStatus;
  error: string | null;
  createdAt: string;
}

export interface NoteItem {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageItem[];
  notes: NoteItem[];
}

export interface ActionResult {
  ok: boolean;
  error?: FormError;
}

/** Accès aux données de l'inbox : implémenté pour Supabase et pour le mode démo. */
export interface InboxRepository {
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<ConversationDetail | null>;
  sendReply(conversationId: string, body: string): Promise<ActionResult>;
  setStatus(conversationId: string, status: ConversationStatus): Promise<ActionResult>;
  markRead(conversationId: string): Promise<ActionResult>;
  addNote(conversationId: string, body: string): Promise<ActionResult>;
}
