import type { FormError } from '@/lib/form-error';
import type { ConversationStatus, ConversationSummary } from './types';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** En dessous de ce temps restant, la fenêtre de réponse est signalée comme urgente. */
export const URGENT_THRESHOLD_MS = 4 * HOUR;

export type WindowState = 'none' | 'open' | 'urgent' | 'expired';

export interface ReplyWindow {
  state: WindowState;
  remainingMs: number;
}

/** Durée restante découpée : l'affichage (« 19 h », « 2 h 15 », « 12 min ») est traduit par l'interface. */
export type Remaining = { kind: 'lessThanMinute' } | { kind: 'minutes'; m: number } | { kind: 'hours'; h: number } | { kind: 'hoursMinutes'; h: number; m: string };

export function splitRemaining(ms: number): Remaining {
  if (ms < MINUTE) return { kind: 'lessThanMinute' };
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  if (h === 0) return { kind: 'minutes', m };
  if (h >= 10 || m === 0) return { kind: 'hours', h };
  return { kind: 'hoursMinutes', h, m: String(m).padStart(2, '0') };
}

/** Fenêtre de réponse Meta (24 h après le dernier message entrant). */
export function replyWindow(expiresAt: string | null, now: Date = new Date()): ReplyWindow {
  if (!expiresAt) return { state: 'none', remainingMs: 0 };
  const remainingMs = new Date(expiresAt).getTime() - now.getTime();
  if (remainingMs <= 0) return { state: 'expired', remainingMs: 0 };
  return { state: remainingMs <= URGENT_THRESHOLD_MS ? 'urgent' : 'open', remainingMs };
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

/** Une réponse peut-elle partir ? Renvoie une erreur (clé de message) sinon. */
export function validateReply(body: string, window: ReplyWindow): FormError | null {
  const text = body.trim();
  if (!text) return { key: 'app.validation.replyEmpty' };
  if (text.length > MAX_REPLY_LENGTH) return { key: 'app.validation.replyTooLong', params: { max: MAX_REPLY_LENGTH } };
  if (window.state === 'expired') return { key: 'app.validation.windowExpired' };
  return null;
}
