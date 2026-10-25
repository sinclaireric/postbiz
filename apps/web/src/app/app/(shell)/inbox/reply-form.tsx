'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { SparklesIcon } from '@/components/calendar/composer-icons';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';
import { MAX_REPLY_LENGTH } from '@/lib/inbox/logic';
import type { Suggestion, SuggestErrorCode } from '@/lib/inbox/suggest';
import { addNoteAction, sendReplyAction, type ReplyState } from './actions';

const SUGGEST_ERROR: Record<SuggestErrorCode, MessageKey> = {
  disabled: 'app.inbox.suggest.errors.disabled', forbidden: 'app.inbox.suggest.errors.forbidden', invalid: 'app.inbox.suggest.errors.invalid', rate_limited: 'app.inbox.suggest.errors.rate_limited',
  refused: 'app.inbox.suggest.errors.refused', failed: 'app.inbox.suggest.errors.failed', not_found: 'app.inbox.suggest.errors.not_found', window_closed: 'app.inbox.suggest.errors.window_closed',
};

type SuggestState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; suggestion: Suggestion } | { status: 'error'; code: SuggestErrorCode };

function Submit({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  const t = useT();
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{pending ? t('app.inbox.sending') : children}</Button>;
}

export function ReplyForm({ conversationId, disabled, disabledReason, placeholder, canSuggest }: {
  conversationId: string; disabled: boolean; disabledReason?: string; placeholder: string; canSuggest: boolean;
}) {
  const t = useT();
  const [state, action] = useActionState<ReplyState, FormData>(sendReplyAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const [suggest, setSuggest] = useState<SuggestState>({ status: 'idle' });

  useEffect(() => {
    if (state.sentAt) {
      ref.current?.reset();
      setSuggest({ status: 'idle' });
    }
  }, [state.sentAt]);

  /** Demande un brouillon à l'IA et le met dans le champ ; une personne le relit, le corrige et l'envoie. */
  async function suggestReply() {
    if (suggest.status === 'loading') return;
    setSuggest({ status: 'loading' });
    try {
      const res = await fetch('/api/inbox/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId }) });
      const data = (await res.json().catch(() => null)) as { suggestion?: Suggestion; error?: SuggestErrorCode } | null;
      if (!res.ok || !data?.suggestion) return setSuggest({ status: 'error', code: data?.error ?? 'failed' });
      const field = body.current;
      // Un texte déjà commencé n'est remplacé que si la personne le veut.
      if (field && data.suggestion.reply && (!field.value.trim() || window.confirm(t('app.inbox.suggest.replaceConfirm')))) {
        field.value = data.suggestion.reply;
        field.focus();
      }
      setSuggest({ status: 'done', suggestion: data.suggestion });
    } catch {
      setSuggest({ status: 'error', code: 'failed' });
    }
  }

  if (disabled) {
    return <p className="border-t border-line bg-warn-soft px-5 py-4 text-sm leading-relaxed text-warn">{disabledReason}</p>;
  }

  return (
    <form ref={ref} action={action} className="border-t border-line bg-surface p-4">
      <input type="hidden" name="conversationId" value={conversationId} />
      {suggest.status === 'done' && suggest.suggestion.id && <input type="hidden" name="suggestionId" value={suggest.suggestion.id} />}
      <label htmlFor="reply-body" className="sr-only">{t('app.inbox.replyLabel')}</label>
      <textarea
        ref={body}
        dir="auto"
        id="reply-body"
        name="body"
        rows={3}
        maxLength={MAX_REPLY_LENGTH}
        placeholder={placeholder}
        required
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.currentTarget.form?.requestSubmit();
        }}
        className="w-full resize-none rounded-2xl border border-line bg-paper px-4 py-3 text-[15px] outline-none transition focus:border-ink focus:ring-4 focus:ring-lime/40"
      />
      <div aria-live="polite">
        {suggest.status === 'done' && (
          <div className="mt-2 grid gap-1 text-xs leading-relaxed">
            <p className="font-medium text-forest">{t('app.inbox.suggest.draft')}</p>
            {suggest.suggestion.needsHuman && <p className="font-medium text-warn">{t('app.inbox.suggest.needsHuman')}</p>}
            {!suggest.suggestion.grounded && <p className="font-medium text-warn">{t('app.inbox.suggest.ungrounded')}</p>}
            {suggest.suggestion.sources.length > 0 && <p className="text-subtle">{t('app.inbox.suggest.sources', { titles: suggest.suggestion.sources.join(', ') })}</p>}
          </div>
        )}
        {suggest.status === 'error' && <p role="alert" className="mt-2 text-xs font-medium text-danger">{t(SUGGEST_ERROR[suggest.code])}</p>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">{t('app.inbox.shortcut')}</p>
        <div className="flex items-center gap-3">
          {state.error && <p role="alert" className="text-sm font-medium text-danger">{state.error}</p>}
          {canSuggest && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void suggestReply()} disabled={suggest.status === 'loading'}>
              <SparklesIcon width={15} height={15} className={suggest.status === 'loading' ? 'animate-pulse' : ''} />
              {suggest.status === 'loading' ? t('app.inbox.suggest.loading') : t('app.inbox.suggest.button')}
            </Button>
          )}
          <Submit>{t('app.inbox.send')}</Submit>
        </div>
      </div>
    </form>
  );
}

export function NoteForm({ conversationId }: { conversationId: string }) {
  const t = useT();
  const [state, action] = useActionState<ReplyState, FormData>(addNoteAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.sentAt) ref.current?.reset();
  }, [state.sentAt]);

  return (
    <form ref={ref} action={action} className="grid gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor="note-body" className="sr-only">{t('app.inbox.notes.label')}</label>
      <textarea id="note-body" dir="auto" name="body" rows={2} maxLength={2000} placeholder={t('app.inbox.notes.placeholder')} required
        className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink focus:ring-4 focus:ring-lime/40" />
      <div className="flex items-center justify-between">
        {state.error ? <p role="alert" className="text-xs font-medium text-danger">{state.error}</p> : <span />}
        <Submit variant="secondary">{t('app.inbox.notes.add')}</Submit>
      </div>
    </form>
  );
}
