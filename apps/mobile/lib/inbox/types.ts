// Types de l'inbox, repris de apps/web/src/lib/inbox/types.ts (seul NetworkId diffère : pas d'alias « @/lib/networks » ici).
// logic.ts est une copie identique de apps/web/src/lib/inbox/logic.ts : `npm run check:inbox-logic` détecte une dérive.
export type NetworkId = 'facebook' | 'instagram' | 'x' | 'linkedin' | 'tiktok' | 'youtube';
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
