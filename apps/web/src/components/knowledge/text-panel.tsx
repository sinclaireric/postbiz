'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { deleteKnowledgeAction, reindexItemAction, reindexMissingAction, saveKnowledgeAction, setPinnedAction, type KnowledgeFormState } from '@/app/app/(shell)/connaissances/actions';
import { PencilIcon, PlusIcon, TrashIcon } from '@/components/calendar/composer-icons';
import { Badge, Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { formatNumber } from '@/i18n/format';
import { KNOWLEDGE_BUDGET } from '@/lib/ai/prompt';
import { KNOWLEDGE_LIMITS, type KnowledgeItem } from '@/lib/data/types';
import { splitKnowledge } from '@/lib/kb/split';

const initial: KnowledgeFormState = {};

function SaveButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? t('auth.wait') : t('app.knowledge.save')}</Button>;
}

/** L'interrupteur « toujours utilisée » d'une fiche : un formulaire à lui, pour que le changement soit enregistré tout de suite. */
function PinSwitch({ item, canWrite }: { item: KnowledgeItem; canWrite: boolean }) {
  const t = useT();
  return (
    <form action={setPinnedAction}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="pinned" value={item.pinned ? '0' : '1'} />
      <button
        type="submit" role="switch" aria-checked={item.pinned} disabled={!canWrite} aria-label={t('app.knowledgePage.pin.switch', { title: item.title })}
        title={t('app.knowledgePage.pin.hint')}
        className={`relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-60 ${item.pinned ? 'bg-ink' : 'bg-line'}`}
      >
        <span aria-hidden="true" className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${item.pinned ? 'start-[18px]' : 'start-0.5'}`} />
      </button>
    </form>
  );
}

function IndexBadge({ item, embeddings }: { item: KnowledgeItem; embeddings: boolean }) {
  const t = useT();
  if (item.indexedAt === null) return <Badge tone="warn">{t('app.knowledgePage.state.pending')}</Badge>;
  if (item.embeddedAt === null && embeddings) return <Badge tone="warn">{t('app.knowledgePage.state.words')}</Badge>;
  return <Badge tone="ok">{t('app.knowledgePage.state.indexed')}</Badge>;
}

/** Les fiches de texte : ton de la marque, offres, questions fréquentes. `all` : toutes les sources de la base (documents et sites comptent dans les 100). */
export function TextPanel({ items, all, canWrite, embeddings }: { items: KnowledgeItem[]; all: KnowledgeItem[]; canWrite: boolean; embeddings: boolean }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<KnowledgeItem | 'new' | null>(null);
  const [state, action] = useActionState(saveKnowledgeAction, initial);
  const [length, setLength] = useState(0);
  // Le budget se calcule sur toutes les fiches : seules les fiches de texte sont épinglées, et le total ne change pas.
  const split = useMemo(() => splitKnowledge(all), [all]);
  // Les nombres suivent la langue de l'application, la même sur le serveur et dans le navigateur (sinon la page ne s'hydrate pas).
  const num = (n: number) => formatNumber(t.locale, n);
  const missing = items.filter((i) => i.indexedAt === null).length;
  const triggered = useRef(false);

  useEffect(() => {
    if (state.savedAt) setEditing(null);
  }, [state.savedAt]);
  useEffect(() => setLength(editing && editing !== 'new' ? editing.content.length : 0), [editing]);

  // Les fiches jamais indexées (celles d'avant la recherche, ou modifiées depuis) le sont à l'ouverture de la page, une fois.
  useEffect(() => {
    if (!canWrite || missing === 0 || triggered.current) return;
    triggered.current = true;
    void reindexMissingAction().then((done) => { if (done > 0) router.refresh(); }).catch(() => undefined);
  }, [canWrite, missing, router]);

  const full = all.length >= KNOWLEDGE_LIMITS.items;
  const share = Math.min(100, Math.round((split.pinnedChars / KNOWLEDGE_BUDGET) * 100));

  return (
    <div className="grid grid-cols-1 gap-5">
      <section className="rounded-2xl border border-line bg-surface p-4" aria-label={t('app.knowledgePage.budget', { used: num(split.pinnedChars), max: num(KNOWLEDGE_BUDGET) })}>
        <p className="text-sm font-semibold">{t('app.knowledgePage.budget', { used: num(split.pinnedChars), max: num(KNOWLEDGE_BUDGET) })}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-wash" aria-hidden="true">
          <div className={`h-full rounded-full ${split.overflow.length > 0 ? 'bg-warn' : 'bg-ink'}`} style={{ width: `${share}%` }} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-subtle">{t('app.knowledgePage.pin.hint')}</p>
        {split.overflow.length > 0 && <p role="status" className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium leading-relaxed text-warn">{t('app.knowledgePage.overBudget')}</p>}
      </section>

      {editing ? (
        <form action={action} className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-surface p-4">
          {editing !== 'new' && <input type="hidden" name="id" value={editing.id} />}
          <div>
            <label htmlFor="kb-title" className="text-sm font-semibold">{t('app.knowledge.titleLabel')}</label>
            <input
              id="kb-title" name="title" required maxLength={KNOWLEDGE_LIMITS.title} defaultValue={editing === 'new' ? '' : editing.title} placeholder={t('app.knowledge.titlePlaceholder')}
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-paper px-3 text-[14px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
            />
          </div>
          <div>
            <label htmlFor="kb-content" className="text-sm font-semibold">{t('app.knowledge.contentLabel')}</label>
            <textarea
              id="kb-content" name="content" required rows={8} maxLength={KNOWLEDGE_LIMITS.content} defaultValue={editing === 'new' ? '' : editing.content} placeholder={t('app.knowledge.contentPlaceholder')}
              onChange={(e) => setLength(e.target.value.length)}
              className="mt-1.5 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2.5 text-[14px] leading-relaxed outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
            />
            <p className="mt-1 text-end text-xs text-subtle">{num(length)} / {num(KNOWLEDGE_LIMITS.content)}</p>
          </div>
          {state.error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{state.error}</p>}
          <div className="flex gap-2">
            <SaveButton />
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('app.knowledge.cancel')}</Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('app.knowledgePage.list')}</h2>
          <Button type="button" size="sm" variant="secondary" disabled={!canWrite || full} onClick={() => setEditing('new')}>
            <PlusIcon width={15} height={15} />{t('app.knowledge.add')}
          </Button>
        </div>
      )}

      {items.length === 0 && !editing ? (
        <p className="rounded-2xl bg-wash px-4 py-6 text-center text-sm text-muted">{t('app.knowledgePage.empty')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{item.content}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <PinSwitch item={item} canWrite={canWrite} />
                  {canWrite && (
                    <>
                      <button type="button" onClick={() => setEditing(item)} aria-label={t('app.knowledge.edit')} title={t('app.knowledge.edit')} className="rounded-full p-1.5 text-muted hover:bg-wash hover:text-ink"><PencilIcon width={15} height={15} /></button>
                      <form action={deleteKnowledgeAction} onSubmit={(e) => { if (!window.confirm(t('app.knowledge.confirmDelete', { title: item.title }))) e.preventDefault(); }}>
                        <input type="hidden" name="id" value={item.id} />
                        <button type="submit" aria-label={t('app.knowledge.delete')} title={t('app.knowledge.delete')} className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger"><TrashIcon width={15} height={15} /></button>
                      </form>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge tone={item.pinned ? 'lime' : 'neutral'}>{item.pinned ? t('app.knowledgePage.pin.on') : t('app.knowledgePage.pin.off')}</Badge>
                <IndexBadge item={item} embeddings={embeddings} />
                {item.chunkCount > 0 && <span className="text-xs text-subtle">{t('app.knowledgePage.state.passages', { count: item.chunkCount })}</span>}
                {canWrite && (item.indexedAt === null || (embeddings && item.embeddedAt === null)) && (
                  <form action={reindexItemAction} className="ms-auto">
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="text-xs font-semibold text-ink underline underline-offset-4 hover:text-black/70">{t('app.knowledgePage.reindex')}</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
