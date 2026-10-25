'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import {
  deleteKnowledgeAction, reindexItemAction, reindexMissingAction, saveKnowledgeAction, searchKnowledgeAction, setPinnedAction,
  type KnowledgeFormState, type KnowledgeTestResult,
} from '@/app/app/(shell)/connaissances/actions';
import { PencilIcon, PlusIcon, SparklesIcon, TrashIcon } from '@/components/calendar/composer-icons';
import { Badge, Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/types';
import { KNOWLEDGE_BUDGET } from '@/lib/ai/prompt';
import { KNOWLEDGE_LIMITS, type KnowledgeItem } from '@/lib/data/types';
import { KB } from '@/lib/kb/types';
import { splitKnowledge } from '@/lib/kb/split';

const initial: KnowledgeFormState = {};

function SaveButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? t('auth.wait') : t('app.knowledge.save')}</Button>;
}

const TEST_ERROR: Record<Extract<KnowledgeTestResult, { ok: false }>['error'] | 'failed', MessageKey> = {
  forbidden: 'app.knowledgePage.test.errors.forbidden', invalid: 'app.knowledgePage.test.errors.invalid',
  rate_limited: 'app.knowledgePage.test.errors.rate_limited', failed: 'app.knowledgePage.test.errors.failed',
};

/** « Tester une question » : montre les passages que l'IA retrouverait, pour savoir ce que la base sait vraiment et pourquoi une réponse manque. */
function TestBox() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<KnowledgeTestResult | { ok: false; error: 'failed' } | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    const q = query.trim();
    if (!q || pending) return;
    start(async () => {
      try {
        setResult(await searchKnowledgeAction(q));
      } catch {
        setResult({ ok: false, error: 'failed' });
      }
    });
  };

  return (
    <section aria-labelledby="kb-test-title" className="rounded-2xl border border-line bg-surface p-4">
      <h2 id="kb-test-title" className="flex items-center gap-2 text-base font-semibold"><SparklesIcon width={16} height={16} className="text-forest" />{t('app.knowledgePage.test.title')}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{t('app.knowledgePage.test.hint')}</p>
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="mt-3 flex gap-2">
        <label htmlFor="kb-test-query" className="sr-only">{t('app.knowledgePage.test.title')}</label>
        <input
          id="kb-test-query" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={KB.queryChars} placeholder={t('app.knowledgePage.test.placeholder')}
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 text-[14px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40"
        />
        <Button type="submit" size="sm" disabled={pending || !query.trim()}>{pending ? t('app.knowledgePage.test.running') : t('app.knowledgePage.test.run')}</Button>
      </form>

      <div aria-live="polite" className="mt-3">
        {result && !result.ok && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{t(TEST_ERROR[result.error])}</p>}
        {result?.ok && (
          <div className="grid gap-2.5">
            <p className="text-xs font-semibold text-subtle">{result.mode === 'hybrid' ? t('app.knowledgePage.test.hybrid') : t('app.knowledgePage.test.words')}</p>
            {!result.found && <p className="rounded-xl bg-warn-soft px-3 py-2.5 text-sm leading-relaxed text-warn">{t('app.knowledgePage.test.none')}</p>}
            {result.passages.length > 0 && (
              <ul className="grid gap-2">
                {result.passages.map((p) => (
                  <li key={p.id} className={`rounded-xl border p-3 ${p.relevant ? 'border-line bg-paper' : 'border-dashed border-line bg-paper opacity-60'}`}>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                      <span>{p.title}</span>
                      {p.heading && <span className="font-normal text-subtle">· {p.heading}</span>}
                      <Badge tone={p.relevant ? 'ok' : 'neutral'}>{p.relevant ? t('app.knowledgePage.test.relevant') : t('app.knowledgePage.test.weak')}</Badge>
                    </p>
                    <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-muted">{p.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
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

export function KnowledgeView({ items, canWrite, embeddings, demo }: { items: KnowledgeItem[]; canWrite: boolean; embeddings: boolean; demo: boolean }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<KnowledgeItem | 'new' | null>(null);
  const [state, action] = useActionState(saveKnowledgeAction, initial);
  const [length, setLength] = useState(0);
  const split = useMemo(() => splitKnowledge(items), [items]);
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

  const full = items.length >= KNOWLEDGE_LIMITS.items;
  const share = Math.min(100, Math.round((split.pinnedChars / KNOWLEDGE_BUDGET) * 100));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-3xl gap-5 p-5 sm:p-7">
        <header>
          <p className="text-sm leading-relaxed text-muted">{t('app.knowledgePage.intro')}</p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">{t('app.knowledgePage.privacy')}</p>
          {demo && <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">{t('app.knowledgePage.demoNote')}</p>}
          {!demo && !embeddings && <p role="status" className="mt-3 rounded-xl bg-wash px-3 py-2 text-xs leading-relaxed text-muted">{t('app.knowledgePage.noEmbeddings')}</p>}
        </header>

        <section className="rounded-2xl border border-line bg-surface p-4" aria-label={t('app.knowledgePage.budget', { used: num(split.pinnedChars), max: num(KNOWLEDGE_BUDGET) })}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">{t('app.knowledgePage.budget', { used: num(split.pinnedChars), max: num(KNOWLEDGE_BUDGET) })}</p>
            <p className="text-xs text-subtle">{t('app.knowledge.count', { count: items.length, max: KNOWLEDGE_LIMITS.items })}</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-wash" aria-hidden="true">
            <div className={`h-full rounded-full ${split.overflow.length > 0 ? 'bg-warn' : 'bg-ink'}`} style={{ width: `${share}%` }} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-subtle">{t('app.knowledgePage.pin.hint')}</p>
          {split.overflow.length > 0 && <p role="status" className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium leading-relaxed text-warn">{t('app.knowledgePage.overBudget')}</p>}
        </section>

        {editing ? (
          <form action={action} className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
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
        {!canWrite && <p className="text-xs text-muted">{t('app.knowledge.viewerNote')}</p>}

        {items.length === 0 && !editing ? (
          <p className="rounded-2xl bg-wash px-4 py-6 text-center text-sm text-muted">{t('app.knowledgePage.empty')}</p>
        ) : (
          <ul className="grid gap-2.5">
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

        {items.length > 0 && <TestBox />}
        <p className="text-center text-xs text-subtle">{t('app.knowledgePage.soon')}</p>
      </div>
    </div>
  );
}
