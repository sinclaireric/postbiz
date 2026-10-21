'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { deleteKnowledgeAction, saveKnowledgeAction, type KnowledgeFormState } from '@/app/app/(shell)/calendrier/knowledge-actions';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { KNOWLEDGE_LIMITS, type KnowledgeItem } from '@/lib/data/types';
import { PencilIcon, PlusIcon, TrashIcon } from './composer-icons';

const initial: KnowledgeFormState = {};

function SaveButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? t('auth.wait') : t('app.knowledge.save')}</Button>;
}

/** Base de connaissance : les fiches que l'assistant lit pour écrire dans la voix de l'organisation. */
export function KnowledgePanel({ items, canWrite }: { items: KnowledgeItem[]; canWrite: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState<KnowledgeItem | 'new' | null>(null);
  const [state, action] = useActionState(saveKnowledgeAction, initial);
  const [length, setLength] = useState(0);

  useEffect(() => {
    if (state.savedAt) setEditing(null);
  }, [state.savedAt]);
  useEffect(() => setLength(editing && editing !== 'new' ? editing.content.length : 0), [editing]);

  const full = items.length >= KNOWLEDGE_LIMITS.items;

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm leading-relaxed text-muted">{t('app.knowledge.intro')}</p>
        <p className="mt-2 text-xs text-subtle">{t('app.ai.privacy')}</p>
      </div>

      {editing ? (
        <form action={action} className="grid gap-3 rounded-2xl border border-line bg-paper p-4">
          {editing !== 'new' && <input type="hidden" name="id" value={editing.id} />}
          <div>
            <label htmlFor="kb-title" className="text-sm font-semibold">{t('app.knowledge.titleLabel')}</label>
            <input
              id="kb-title" name="title" required maxLength={KNOWLEDGE_LIMITS.title} defaultValue={editing === 'new' ? '' : editing.title} placeholder={t('app.knowledge.titlePlaceholder')}
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
            />
          </div>
          <div>
            <label htmlFor="kb-content" className="text-sm font-semibold">{t('app.knowledge.contentLabel')}</label>
            <textarea
              id="kb-content" name="content" required rows={7} maxLength={KNOWLEDGE_LIMITS.content} defaultValue={editing === 'new' ? '' : editing.content} placeholder={t('app.knowledge.contentPlaceholder')}
              onChange={(e) => setLength(e.target.value.length)}
              className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] leading-relaxed outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
            />
            <p className="mt-1 text-end text-xs text-subtle">{length.toLocaleString()} / {KNOWLEDGE_LIMITS.content.toLocaleString()}</p>
          </div>
          {state.error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{state.error}</p>}
          <div className="flex gap-2">
            <SaveButton />
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('app.knowledge.cancel')}</Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-subtle">{t('app.knowledge.count', { count: items.length, max: KNOWLEDGE_LIMITS.items })}</p>
          <Button type="button" size="sm" variant="secondary" disabled={!canWrite || full} onClick={() => setEditing('new')}>
            <PlusIcon width={15} height={15} />{t('app.knowledge.add')}
          </Button>
        </div>
      )}
      {!canWrite && <p className="text-xs text-muted">{t('app.knowledge.viewerNote')}</p>}

      {items.length === 0 && !editing ? (
        <p className="rounded-2xl bg-wash px-4 py-6 text-center text-sm text-muted">{t('app.knowledge.empty')}</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-semibold">{item.title}</p>
                {canWrite && (
                  <div className="flex shrink-0 gap-0.5">
                    <button type="button" onClick={() => setEditing(item)} aria-label={t('app.knowledge.edit')} title={t('app.knowledge.edit')} className="rounded-full p-1.5 text-muted hover:bg-wash hover:text-ink"><PencilIcon width={15} height={15} /></button>
                    <form action={deleteKnowledgeAction} onSubmit={(e) => { if (!window.confirm(t('app.knowledge.confirmDelete', { title: item.title }))) e.preventDefault(); }}>
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" aria-label={t('app.knowledge.delete')} title={t('app.knowledge.delete')} className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger"><TrashIcon width={15} height={15} /></button>
                    </form>
                  </div>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{item.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
