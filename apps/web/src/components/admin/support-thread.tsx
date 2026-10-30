'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { markReadAction, refreshThreadAction, replyAction, setStatusAction } from '@/app/admin/support/actions';
import { useLocale } from '@/i18n/client';
import { formatLongDay, formatNumber, formatTime } from '@/i18n/format';
import { SUPPORT_REPLY_MAX, mergeMessages } from '@/lib/support/logic';
import type { AdminSupportActionResult, AdminSupportThread, SupportMessage } from '@/lib/support/types';

/** Les textes de l'espace propriétaire (`admin.*`) restent sur le serveur : la page les envoie ici déjà traduits. */
export interface SupportThreadLabels {
  support: string;
  reply: string;
  placeholder: string;
  send: string;
  sending: string;
  hint: string;
  resolve: string;
  reopen: string;
  resolvedNote: string;
  truncated: string;
  profile: string;
  workspace: string;
  empty: string;
  /** Message de chaque erreur possible de `AdminSupportActionResult`. */
  errors: Record<Extract<AdminSupportActionResult, { ok: false }>['code'], string>;
}

const POLL_MS = 8_000;

const adopt = (current: AdminSupportThread, incoming: AdminSupportThread): AdminSupportThread => ({ ...incoming, messages: mergeMessages(current.messages, incoming.messages) });

function Bubble({ message, name, labels }: { message: SupportMessage; name: string; labels: SupportThreadLabels }) {
  const locale = useLocale();
  const mine = message.author === 'support';
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <span className="mb-1 flex items-center gap-2 px-1 text-xs text-subtle">
        <span className="font-semibold text-muted">{mine ? labels.support : name}</span>
        <time dateTime={message.createdAt}>{formatTime(locale, message.createdAt)}</time>
      </span>
      {/* Texte brut, échappé par React : aucun lien cliquable, aucune interprétation du HTML. */}
      <p dir="auto" className={`max-w-[min(38rem,90%)] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap ${mine ? 'rounded-ee-md bg-ink text-white' : 'rounded-es-md border border-line bg-surface text-ink'}`}>
        {message.body}
      </p>
    </li>
  );
}

/** Une conversation du support : le fil (relu toutes les 8 s), la réponse, et « résolu / rouvrir ». Lue dès qu'elle est ouverte. */
export function SupportThreadView({ initial, labels }: { initial: AdminSupportThread; labels: SupportThreadLabels }) {
  const locale = useLocale();
  const id = initial.conversation.id;
  const [thread, setThread] = useState(initial);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLOListElement>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const res = await refreshThreadAction(id).catch(() => null);
    if (res?.ok) setThread((cur) => adopt(cur, res.thread));
  }, [id]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [refresh]);

  // Les messages non lus sont sous les yeux du propriétaire : ils sont lus (compteur de la base, cloche, pastille du menu).
  const unread = thread.conversation.supportUnread;
  useEffect(() => {
    if (unread === 0 || document.visibilityState !== 'visible') return;
    setThread((cur) => ({ ...cur, conversation: { ...cur.conversation, supportUnread: 0 } }));
    void markReadAction(id).catch(() => undefined);
  }, [unread, id]);

  const lastId = thread.messages.at(-1)?.id;
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lastId]);

  async function run(action: () => Promise<AdminSupportActionResult>): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await action();
      if (res.ok) setThread((cur) => adopt(cur, res.thread));
      else setError(labels.errors[res.code]);
      return res.ok;
    } catch {
      setError(labels.errors.failed);
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const length = [...draft].length;
  const tooLong = length > SUPPORT_REPLY_MAX;
  const send = async () => {
    if (!draft.trim() || tooLong) return;
    if (await run(() => replyAction(id, draft))) setDraft('');
  };

  const c = thread.conversation;
  const name = c.name || c.email;
  const resolved = c.status === 'resolved';
  let day = '';
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-3xl border border-line bg-surface px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{name}</p>
          <p className="truncate text-sm text-muted" dir="ltr">{c.email}</p>
          <p className="mt-1 text-sm text-muted">
            {c.orgName && <>{labels.workspace} <span className="font-medium text-ink">{c.orgName}</span> · </>}
            <Link href={`/admin/utilisateurs/${c.userId}`} className="font-semibold underline underline-offset-4 hover:text-ink">{labels.profile}</Link>
          </p>
        </div>
        <button
          type="button" disabled={pending} onClick={() => void run(() => setStatusAction(id, resolved ? 'open' : 'resolved'))}
          className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-semibold hover:bg-wash disabled:opacity-50"
        >
          {resolved ? labels.reopen : labels.resolve}
        </button>
      </div>

      <div className="flex min-h-[360px] flex-col overflow-hidden rounded-3xl border border-line bg-paper">
        {thread.truncated && <p className="border-b border-line bg-wash px-4 py-2 text-xs text-muted">{labels.truncated}</p>}
        <ol ref={log} role="log" aria-live="polite" aria-relevant="additions" aria-label={name} className="flex max-h-[60dvh] min-h-[280px] flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
          {thread.messages.length === 0 && <li className="m-auto text-sm text-muted">{labels.empty}</li>}
          {thread.messages.map((m) => {
            const d = new Date(m.createdAt);
            const key = Number.isNaN(d.getTime()) ? '' : d.toDateString();
            const separator = key && key !== day ? formatLongDay(locale, d) : null;
            if (key) day = key;
            return (
              <Fragment key={m.id}>
                {separator && <li className="self-center py-1 text-xs font-semibold tracking-wide text-subtle">{separator}</li>}
                <Bubble message={m} name={name} labels={labels} />
              </Fragment>
            );
          })}
        </ol>
        {resolved && <p className="border-t border-line bg-ok-soft px-4 py-2.5 text-sm text-ok">{labels.resolvedNote}</p>}

        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="border-t border-line bg-surface p-3">
          <label htmlFor="support-reply" className="sr-only">{labels.reply}</label>
          <textarea
            id="support-reply" dir="auto" rows={4} value={draft} disabled={pending} placeholder={labels.placeholder} aria-describedby="support-reply-hint" aria-invalid={tooLong || undefined}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              // Ctrl / Cmd + Entrée envoie (Entrée seule passe à la ligne : une réponse du support est plus longue qu'un message de chat).
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            className="w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-ink focus:ring-4 focus:ring-lime/40 disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p id="support-reply-hint" className="text-xs text-subtle">
              {labels.hint}{' '}
              <span dir="ltr" className={`tabular-nums ${tooLong ? 'font-semibold text-danger' : ''}`}>{formatNumber(locale, length)} / {formatNumber(locale, SUPPORT_REPLY_MAX)}</span>
            </p>
            <button type="submit" disabled={pending || !draft.trim() || tooLong} className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-black/80 disabled:pointer-events-none disabled:opacity-50">
              {pending ? labels.sending : labels.send}
            </button>
          </div>
          {(error || tooLong) && <p role="alert" className="mt-2 text-sm text-danger">{tooLong ? labels.errors.message_too_long : error}</p>}
        </form>
      </div>
    </div>
  );
}
