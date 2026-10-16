import type { ConversationStatus, ConversationSummary } from './types';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** En dessous de ce temps restant, la fenêtre de réponse est signalée comme urgente. */
export const URGENT_THRESHOLD_MS = 4 * HOUR;

export type WindowState = 'none' | 'open' | 'urgent' | 'expired';

export interface ReplyWindow {
  state: WindowState;
  remainingMs: number;
  label: string;
}

/** Durée restante lisible : « 19 h », « 2 h 15 », « 12 min ». */
export function formatRemaining(ms: number): string {
  if (ms < MINUTE) return 'moins d’1 min';
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  if (h === 0) return `${m} min`;
  if (h >= 10 || m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** Fenêtre de réponse Meta (24 h après le dernier message entrant). */
export function replyWindow(expiresAt: string | null, now: Date = new Date()): ReplyWindow {
  if (!expiresAt) return { state: 'none', remainingMs: 0, label: '' };
  const remainingMs = new Date(expiresAt).getTime() - now.getTime();
  if (remainingMs <= 0) return { state: 'expired', remainingMs: 0, label: 'Fenêtre de réponse expirée' };
  const label = `Répondre sous ${formatRemaining(remainingMs)}`;
  return { state: remainingMs <= URGENT_THRESHOLD_MS ? 'urgent' : 'open', remainingMs, label };
}

/** Ancienneté relative en français : « à l’instant », « 5 min », « 3 h », « hier », « 12 oct. ». */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MINUTE) return 'à l’instant';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} h`;
  if (diff < 48 * HOUR) return 'hier';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export interface InboxFilters {
  /** `active` = ouvertes, en attente et reportées (tout sauf fermées). */
  status?: ConversationStatus | 'all' | 'unread' | 'active';
  network?: string;
  q?: string;
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterConversations(list: ConversationSummary[], f: InboxFilters): ConversationSummary[] {
  const q = f.q ? normalize(f.q.trim()) : '';
  return list.filter((c) => {
    if (f.status === 'unread' && c.unreadCount === 0) return false;
    if (f.status === 'active' && c.status === 'closed') return false;
    if (f.status && f.status !== 'all' && f.status !== 'unread' && f.status !== 'active' && c.status !== f.status) return false;
    if (f.network && f.network !== 'all' && c.networkId !== f.network) return false;
    if (q) {
      const hay = normalize(`${c.contactName} ${c.contactUsername ?? ''} ${c.lastMessagePreview}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Ordre d'affichage : d'abord les fenêtres de réponse qui vont expirer (les plus proches en premier),
 * puis le reste par date du dernier message, du plus récent au plus ancien. Les conversations fermées en dernier.
 */
export function sortConversations(list: ConversationSummary[], now: Date = new Date()): ConversationSummary[] {
  const rank = (c: ConversationSummary) => {
    if (c.status === 'closed') return 2;
    return replyWindow(c.replyWindowExpiresAt, now).state === 'urgent' ? 0 : 1;
  };
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      return new Date(a.replyWindowExpiresAt!).getTime() - new Date(b.replyWindowExpiresAt!).getTime();
    }
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });
}

export const MAX_REPLY_LENGTH = 2000;

/** Une réponse peut-elle partir ? Renvoie un message d'erreur sinon. */
export function validateReply(body: string, window: ReplyWindow): string | null {
  const text = body.trim();
  if (!text) return 'Écrivez un message avant d’envoyer.';
  if (text.length > MAX_REPLY_LENGTH) return `Le message dépasse ${MAX_REPLY_LENGTH} caractères.`;
  if (window.state === 'expired') {
    return 'La fenêtre de 24 h est dépassée : Meta n’autorise plus de réponse à cette conversation.';
  }
  return null;
}

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  open: 'Ouverte',
  pending: 'En attente',
  snoozed: 'Reportée',
  closed: 'Fermée',
};
