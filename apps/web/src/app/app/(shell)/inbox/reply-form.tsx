'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { MAX_REPLY_LENGTH } from '@/lib/inbox/logic';
import { addNoteAction, sendReplyAction, type ReplyState } from './actions';

function Submit({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{pending ? 'Envoi…' : children}</Button>;
}

export function ReplyForm({ conversationId, disabled, disabledReason, placeholder }: {
  conversationId: string; disabled: boolean; disabledReason?: string; placeholder: string;
}) {
  const [state, action] = useActionState<ReplyState, FormData>(sendReplyAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.sentAt) ref.current?.reset();
  }, [state.sentAt]);

  if (disabled) {
    return <p className="border-t border-line bg-warn-soft px-5 py-4 text-sm leading-relaxed text-warn">{disabledReason}</p>;
  }

  return (
    <form ref={ref} action={action} className="border-t border-line bg-surface p-4">
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor="reply-body" className="sr-only">Votre réponse</label>
      <textarea
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
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">Ctrl/⌘ + Entrée pour envoyer</p>
        <div className="flex items-center gap-3">
          {state.error && <p role="alert" className="text-sm font-medium text-danger">{state.error}</p>}
          <Submit>Envoyer</Submit>
        </div>
      </div>
    </form>
  );
}

export function NoteForm({ conversationId }: { conversationId: string }) {
  const [state, action] = useActionState<ReplyState, FormData>(addNoteAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.sentAt) ref.current?.reset();
  }, [state.sentAt]);

  return (
    <form ref={ref} action={action} className="grid gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor="note-body" className="sr-only">Note interne</label>
      <textarea id="note-body" name="body" rows={2} maxLength={2000} placeholder="Note visible par l’équipe uniquement…" required
        className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink focus:ring-4 focus:ring-lime/40" />
      <div className="flex items-center justify-between">
        {state.error ? <p role="alert" className="text-xs font-medium text-danger">{state.error}</p> : <span />}
        <Submit variant="secondary">Ajouter la note</Submit>
      </div>
    </form>
  );
}
