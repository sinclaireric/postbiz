'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { markSupportReadAction, refreshSupportAction, sendSupportMessageAction } from '@/app/app/(shell)/support/actions';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { formatLongDay, formatNumber, formatTime } from '@/i18n/format';
import type { MessageKey } from '@/i18n/types';
import { SUPPORT_USER_MAX, mergeMessages } from '@/lib/support/logic';
import type { SupportErrorCode, SupportMessage, SupportThread } from '@/lib/support/types';
import { SUPPORT_UNREAD_EVENT } from './events';
import { useRealtimeTable } from './use-realtime-table';

const ERRORS: Record<SupportErrorCode, MessageKey> = {
  invalid_message: 'app.support.errors.invalid_message',
  message_too_long: 'app.support.errors.message_too_long',
  rate_limited: 'app.support.errors.rate_limited',
  too_many_unanswered: 'app.support.errors.too_many_unanswered',
  failed: 'app.support.errors.failed',
};

/** Sans temps réel : on relit le fil toutes les 8 s ; avec, une fois toutes les 30 s par sécurité. L'onglet masqué ne sonde pas. */
const POLL_MS = { fallback: 8_000, live: 30_000 } as const;

/** Le fil en cours et celui que renvoie le serveur : les messages sont fusionnés (jamais de doublon), l'état et le compteur sont ceux du serveur. */
const adopt = (current: SupportThread, incoming: SupportThread): SupportThread => ({ ...incoming, messages: mergeMessages(current.messages, incoming.messages) });

function Bubble({ message, mine, label }: { message: SupportMessage; mine: boolean; label: string }) {
  const t = useT();
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <span className="mb-1 flex items-center gap-2 px-1 text-xs text-subtle">
        <span className="font-semibold text-muted">{label}</span>
        <time dateTime={message.createdAt}>{formatTime(t.locale, message.createdAt)}</time>
      </span>
      {/* Texte brut : React l'échappe, aucun lien n'est cliquable, la direction du texte suit sa langue. */}
      <p dir="auto" className={`max-w-[min(34rem,88%)] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap ${mine ? 'rounded-ee-md bg-lime-soft text-ink' : 'rounded-es-md border border-line bg-surface text-ink'}`}>
        {message.body}
      </p>
    </li>
  );
}

/** Le chat avec le support : le fil, le champ de saisie, et les réponses en direct. Le fil initial vient du serveur ; ensuite tout passe par les actions de la page. */
export function SupportChat({ initial, realtime, demo }: { initial: SupportThread; realtime: boolean; demo: boolean }) {
  const t = useT();
  const [thread, setThread] = useState(initial);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const log = useRef<HTMLOListElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);

  const refresh = useCallback(async () => {
    const res = await refreshSupportAction().catch(() => ({ ok: false as const }));
    setLoadFailed(!res.ok);
    if (res.ok) setThread((cur) => adopt(cur, res.thread));
  }, []);

  const connected = useRealtimeTable({
    // Pas d'abonnement tant que la conversation n'existe pas (premier message) : l'envoi la crée, puis l'abonnement s'ouvre.
    enabled: realtime && !demo && Boolean(thread.conversationId), name: 'support-thread', table: 'support_messages', filter: `conversation_id=eq.${thread.conversationId ?? ''}`,
    onChange: () => void refresh(),
  });

  // Relecture régulière quand l'onglet est visible, et dès qu'il le redevient.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const id = window.setInterval(tick, connected ? POLL_MS.live : POLL_MS.fallback);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [connected, refresh]);

  // Des réponses non lues sont sous les yeux de la personne : elles sont lues (compteur de la base, cloche, pastille de l'en-tête).
  const unread = thread.unread;
  useEffect(() => {
    if (unread === 0 || document.visibilityState !== 'visible') return;
    setThread((cur) => ({ ...cur, unread: 0 }));
    window.dispatchEvent(new CustomEvent(SUPPORT_UNREAD_EVENT, { detail: 0 }));
    void markSupportReadAction().catch(() => undefined);
  }, [unread]);

  const lastId = thread.messages.at(-1)?.id;
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lastId]);

  const length = [...draft].length;
  const tooLong = length > SUPPORT_USER_MAX;

  async function send() {
    const body = draft;
    if (sending.current || !body.trim() || tooLong) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await sendSupportMessageAction(body);
      if (res.thread) setThread((cur) => adopt(cur, res.thread!));
      if (res.ok) {
        setDraft('');
        field.current?.focus();
      } else {
        setError(ERRORS[res.code]);
      }
    } catch {
      setError(ERRORS.failed);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  let day = '';
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-5 sm:px-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t('app.support.title')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t('app.support.subtitle')}</p>
      </header>

      {demo && (
        <p className="rounded-2xl border border-warn/25 bg-warn-soft px-4 py-2.5 text-sm leading-relaxed text-warn">
          {t('app.support.demoNote')}{' '}
          <Link href="/admin/support" className="font-semibold underline underline-offset-4">{t('app.support.demoLink')}</Link>
        </p>
      )}

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-paper">
        <ol ref={log} role="log" aria-live="polite" aria-relevant="additions" aria-label={t('app.support.title')} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
          {thread.messages.length === 0 && <li className="m-auto max-w-sm px-2 text-center text-sm leading-relaxed text-muted">{t('app.support.empty')}</li>}
          {thread.messages.map((m) => {
            const d = new Date(m.createdAt);
            const key = Number.isNaN(d.getTime()) ? '' : d.toDateString();
            const separator = key && key !== day ? formatLongDay(t.locale, d) : null;
            if (key) day = key;
            return (
              <Fragment key={m.id}>
                {separator && <li className="self-center py-1 text-xs font-semibold tracking-wide text-subtle">{separator}</li>}
                <Bubble message={m} mine={m.author === 'user'} label={m.author === 'user' ? t('app.support.you') : t('app.support.team')} />
              </Fragment>
            );
          })}
        </ol>

        {thread.status === 'resolved' && thread.messages.length > 0 && (
          <p className="border-t border-line bg-ok-soft px-4 py-2.5 text-sm text-ok">{t('app.support.resolved')}</p>
        )}
        {loadFailed && <p role="status" className="border-t border-line bg-warn-soft px-4 py-2 text-xs text-warn">{t('app.support.loadFailed')}</p>}

        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="border-t border-line bg-surface p-3"
        >
          <label htmlFor="support-body" className="sr-only">{t('app.support.messageLabel')}</label>
          <textarea
            ref={field}
            id="support-body"
            dir="auto"
            rows={3}
            value={draft}
            disabled={pending}
            placeholder={t('app.support.placeholder')}
            aria-invalid={tooLong || undefined}
            aria-describedby="support-hint"
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              // Entrée envoie, Maj + Entrée passe à la ligne ; pendant une composition (japonais, chinois, coréen…), Entrée valide la saisie et n'envoie rien.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            className="w-full resize-none rounded-2xl border border-line bg-paper px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-ink focus:ring-4 focus:ring-lime/40 disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p id="support-hint" className="text-xs text-subtle">
              {t('app.support.hint')}{' '}
              <span dir="ltr" className={`tabular-nums ${tooLong ? 'font-semibold text-danger' : ''}`}>{formatNumber(t.locale, length)} / {formatNumber(t.locale, SUPPORT_USER_MAX)}</span>
            </p>
            <Button type="submit" size="sm" disabled={pending || !draft.trim() || tooLong}>{pending ? t('app.support.sending') : t('app.support.send')}</Button>
          </div>
          {(error || tooLong) && (
            <p role="alert" className="mt-2 text-sm text-danger">{t(tooLong ? ERRORS.message_too_long : error!, { max: formatNumber(t.locale, SUPPORT_USER_MAX) })}</p>
          )}
        </form>
      </div>
      <p className="px-1 text-xs leading-relaxed text-subtle">{t('app.support.privacy')}</p>
    </div>
  );
}
