'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { addWebsiteAction, type KnowledgeFormState } from '@/app/app/(shell)/connaissances/actions';
import { PlusIcon } from '@/components/calendar/composer-icons';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { KNOWLEDGE_LIMITS, type KnowledgeItem } from '@/lib/data/types';
import { SourceCard } from './source-card';

const initial: KnowledgeFormState = {};

function AddButton({ disabled }: { disabled: boolean }) {
  const t = useT();
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={disabled || pending}><PlusIcon width={15} height={15} />{pending ? t('app.knowledgePage.sites.adding') : t('app.knowledgePage.sites.add')}</Button>;
}

/** Les sites web : une page, ou tout le site (50 pages au plus), lus par le worker avec les égards d'un robot poli, et relus chaque semaine. */
export function WebsitesPanel({ items, total, canWrite, demo, embeddings }: { items: KnowledgeItem[]; total: number; canWrite: boolean; demo: boolean; embeddings: boolean }) {
  const t = useT();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(addWebsiteAction, initial);
  const full = items.length >= KNOWLEDGE_LIMITS.sites || total >= KNOWLEDGE_LIMITS.items;

  // Le site est enregistré : le formulaire se vide, la liste se rafraîchit (et se met à jour d'elle-même tant qu'une lecture est en cours).
  useEffect(() => {
    if (!state.savedAt) return;
    form.current?.reset();
    router.refresh();
  }, [state.savedAt, router]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <h2 className="text-base font-semibold">{t('app.knowledgePage.tabs.websites')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t('app.knowledgePage.sites.hint', { max: KNOWLEDGE_LIMITS.sitePages })}</p>
      </div>

      {demo && <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">{t('app.knowledgePage.sites.demoNote')}</p>}

      {canWrite ? (
        <form ref={form} action={action} className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-surface p-4">
          <div>
            <label htmlFor="kb-site-url" className="text-sm font-semibold">{t('app.knowledgePage.sites.urlLabel')}</label>
            <input
              id="kb-site-url" name="url" type="text" inputMode="url" required maxLength={2000} autoComplete="off" spellCheck={false} disabled={full} placeholder={t('app.knowledgePage.sites.urlPlaceholder')}
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-paper px-3 text-[14px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40 disabled:opacity-60"
            />
          </div>
          <fieldset disabled={full} className="grid min-w-0 grid-cols-1 gap-1.5">
            <legend className="text-sm font-semibold">{t('app.knowledgePage.sites.scopeLabel')}</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="scope" value="site" defaultChecked className="size-4 accent-ink" />{t('app.knowledgePage.sites.scopeSite', { max: KNOWLEDGE_LIMITS.sitePages })}</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="scope" value="page" className="size-4 accent-ink" />{t('app.knowledgePage.sites.scopePage')}</label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoSync" defaultChecked disabled={full} className="size-4 accent-ink" />{t('app.knowledgePage.sites.autoSync')}</label>
          {state.error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{state.error}</p>}
          {full && <p role="status" className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">{total >= KNOWLEDGE_LIMITS.items ? t('app.knowledge.errLimit', { max: KNOWLEDGE_LIMITS.items }) : t('app.knowledgePage.errors.sitesLimit', { max: KNOWLEDGE_LIMITS.sites })}</p>}
          <div className="flex"><AddButton disabled={full} /></div>
        </form>
      ) : (
        <p className="text-xs text-muted">{t('app.knowledge.viewerNote')}</p>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl bg-wash px-4 py-6 text-center text-sm text-muted">{t('app.knowledgePage.sites.empty')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5">{items.map((item) => <SourceCard key={item.id} item={item} canWrite={canWrite} embeddings={embeddings} demo={demo} />)}</ul>
      )}
    </div>
  );
}
