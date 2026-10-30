'use client';

import { useState, useTransition } from 'react';
import { searchKnowledgeAction, type KnowledgeTestResult } from '@/app/app/(shell)/connaissances/actions';
import { SparklesIcon } from '@/components/calendar/composer-icons';
import { Badge, Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';
import { KB } from '@/lib/kb/types';

const TEST_ERROR: Record<Extract<KnowledgeTestResult, { ok: false }>['error'] | 'failed', MessageKey> = {
  forbidden: 'app.knowledgePage.test.errors.forbidden', invalid: 'app.knowledgePage.test.errors.invalid',
  rate_limited: 'app.knowledgePage.test.errors.rate_limited', failed: 'app.knowledgePage.test.errors.failed',
};

const safeUrl = (href: string | null): string | null => (href && /^https?:\/\//i.test(href) ? href : null);

/** « Tester une question » : montre les passages que l'IA retrouverait, pour savoir ce que la base sait vraiment et pourquoi une réponse manque. */
export function TestBox() {
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
                {result.passages.map((p) => {
                  const link = safeUrl(p.url);
                  return (
                    <li key={p.id} className={`rounded-xl border p-3 ${p.relevant ? 'border-line bg-paper' : 'border-dashed border-line bg-paper opacity-60'}`}>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                        <span>{p.title}</span>
                        {p.pageTitle && <span className="font-normal text-subtle">· {p.pageTitle}</span>}
                        {p.heading && <span className="font-normal text-subtle">· {p.heading}</span>}
                        {p.pages && <span className="font-normal text-subtle">· {t('app.knowledgePage.test.page', { pages: p.pages[0] === p.pages[1] ? String(p.pages[0]) : `${p.pages[0]}–${p.pages[1]}` })}</span>}
                        <Badge tone={p.relevant ? 'ok' : 'neutral'}>{p.relevant ? t('app.knowledgePage.test.relevant') : t('app.knowledgePage.test.weak')}</Badge>
                      </p>
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-xs text-subtle underline underline-offset-2 hover:text-ink">{link}</a>}
                      <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-muted">{p.text}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
