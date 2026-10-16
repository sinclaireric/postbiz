import type { MessageKey, T } from '@/i18n/types';
import { splitRemaining, type Remaining, type ReplyWindow } from './logic';
import type { ConversationStatus } from './types';

export function remainingText(t: T, r: Remaining): string {
  switch (r.kind) {
    case 'lessThanMinute': return t('app.time.lessThanMinute');
    case 'minutes': return t('app.time.minutes', { m: r.m });
    case 'hours': return t('app.time.hours', { h: r.h });
    case 'hoursMinutes': return t('app.time.hoursMinutes', { h: r.h, m: r.m });
  }
}

/** « Répondre sous 19 h » / « Fenêtre de réponse expirée » / vide quand il n'y a pas de fenêtre (commentaires). */
export function windowLabel(t: T, w: ReplyWindow): string {
  if (w.state === 'none') return '';
  if (w.state === 'expired') return t('app.inbox.window.expired');
  return t('app.inbox.window.remaining', { time: remainingText(t, splitRemaining(w.remainingMs)) });
}

export const STATUS_KEY: Record<ConversationStatus, MessageKey> = {
  open: 'app.inbox.status.open',
  pending: 'app.inbox.status.pending',
  snoozed: 'app.inbox.status.snoozed',
  closed: 'app.inbox.status.closed',
};
