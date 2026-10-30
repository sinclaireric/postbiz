'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n/client';
import type { KnowledgeItem, KnowledgeLimits } from '@/lib/data/types';
import { DocumentsPanel } from './documents-panel';
import { TestBox } from './test-box';
import { TextPanel } from './text-panel';
import { WebsitesPanel } from './websites-panel';

type Tab = 'text' | 'documents' | 'websites';
const TABS: Tab[] = ['text', 'documents', 'websites'];

/** Tant qu'un document ou un site attend sa lecture ou est en train d'être lu, la page se met à jour toute seule, toutes les 3 secondes, 15 minutes au plus. */
const POLL_MS = 3_000;
const POLL_FOR_MS = 15 * 60_000;

/**
 * La base de connaissance : ce que l'IA sait de l'activité, pour l'agent, le composeur et l'inbox. Trois sortes de sources en trois onglets : des fiches de texte (dont
 * les épinglées sont envoyées en entier), des documents et des sites web (lus par le worker, consultés par recherche quand la question s'y rapporte).
 */
export function KnowledgeView({ items, limits, canWrite, embeddings, demo, orgId }: { items: KnowledgeItem[]; limits: KnowledgeLimits; canWrite: boolean; embeddings: boolean; demo: boolean; orgId: string }) {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('text');
  const text = useMemo(() => items.filter((i) => i.kind === 'text'), [items]);
  const files = useMemo(() => items.filter((i) => i.kind === 'file'), [items]);
  const sites = useMemo(() => items.filter((i) => i.kind === 'website'), [items]);
  const counts: Record<Tab, number> = { text: text.length, documents: files.length, websites: sites.length };
  const reading = items.some((i) => i.kind !== 'text' && (i.status === 'pending' || i.status === 'processing'));

  useEffect(() => {
    if (!reading) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) clearInterval(timer);
      else router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reading, router]);

  const onKeys = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
    setTab(next);
    document.getElementById(`kb-tab-${next}`)?.focus();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* grid-cols-1 : une colonne qui ne s'élargit pas avec ses enfants (les onglets, un nom de fichier), sinon la page dépasse de l'écran d'un téléphone. */}
      <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 p-5 sm:p-7">
        <header>
          <p className="text-sm leading-relaxed text-muted">{t('app.knowledgePage.intro')}</p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">{t('app.knowledgePage.privacy')}</p>
          {demo && <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">{t('app.knowledgePage.demoNote')}</p>}
          {!demo && !embeddings && <p role="status" className="mt-3 rounded-xl bg-wash px-3 py-2 text-xs leading-relaxed text-muted">{t('app.knowledgePage.noEmbeddings')}</p>}
        </header>

        <div className="flex items-center justify-between gap-3">
          <div role="tablist" aria-label={t('app.knowledgePage.list')} className="flex min-w-0 flex-1 gap-1 rounded-full bg-wash p-1">
            {TABS.map((id) => (
              <button
                key={id} type="button" role="tab" id={`kb-tab-${id}`} aria-selected={tab === id} aria-controls={`kb-panel-${id}`} tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)} onKeyDown={onKeys}
                className={`min-w-0 flex-1 truncate rounded-full px-3 py-2 text-sm font-semibold transition ${tab === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {t(`app.knowledgePage.tabs.${id}`)} <span className="text-xs font-medium text-subtle">{counts[id]}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="-mt-2 text-end text-xs text-subtle">{t('app.knowledgePage.sourcesCount', { count: items.length, max: limits.sources })}</p>

        <div role="tabpanel" id={`kb-panel-${tab}`} aria-labelledby={`kb-tab-${tab}`}>
          {tab === 'text' && <TextPanel items={text} all={items} limits={limits} canWrite={canWrite} embeddings={embeddings} />}
          {tab === 'documents' && <DocumentsPanel items={files} total={items.length} limits={limits} canWrite={canWrite} demo={demo} orgId={orgId} embeddings={embeddings} />}
          {tab === 'websites' && <WebsitesPanel items={sites} total={items.length} limits={limits} canWrite={canWrite} demo={demo} embeddings={embeddings} />}
        </div>

        {items.length > 0 && <TestBox />}
      </div>
    </div>
  );
}
