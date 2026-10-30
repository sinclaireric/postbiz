'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { isSourceError, type SourceErrorCode } from '@postbiz/kb';
import { deleteKnowledgeAction, listPagesAction, requestSyncAction } from '@/app/app/(shell)/connaissances/actions';
import { FileIcon, GlobeIcon, RefreshIcon, TrashIcon } from '@/components/calendar/composer-icons';
import { Badge } from '@/components/ui';
import { useT } from '@/i18n/client';
import { formatBytes, formatRelative } from '@/i18n/format';
import type { MessageKey } from '@/i18n/types';
import type { KnowledgeItem, KnowledgePage } from '@/lib/data/types';
import { useNow } from './use-now';

/** Un message par code d'erreur de lecture (voir SOURCE_ERRORS dans @postbiz/kb) : la page ne montre jamais le texte d'une exception. */
const ERROR_KEYS: Record<SourceErrorCode, MessageKey> = {
  unsupported_type: 'app.knowledgePage.sources.errors.unsupported_type',
  too_large: 'app.knowledgePage.sources.errors.too_large',
  file_missing: 'app.knowledgePage.sources.errors.file_missing',
  corrupt: 'app.knowledgePage.sources.errors.corrupt',
  encrypted: 'app.knowledgePage.sources.errors.encrypted',
  no_text: 'app.knowledgePage.sources.errors.no_text',
  invalid_url: 'app.knowledgePage.sources.errors.invalid_url',
  blocked_address: 'app.knowledgePage.sources.errors.blocked_address',
  dns_failed: 'app.knowledgePage.sources.errors.dns_failed',
  unreachable: 'app.knowledgePage.sources.errors.unreachable',
  timeout: 'app.knowledgePage.sources.errors.timeout',
  tls_error: 'app.knowledgePage.sources.errors.tls_error',
  http_error: 'app.knowledgePage.sources.errors.http_error',
  not_html: 'app.knowledgePage.sources.errors.not_html',
  robots_disallowed: 'app.knowledgePage.sources.errors.robots_disallowed',
  redirect_loop: 'app.knowledgePage.sources.errors.redirect_loop',
  empty_site: 'app.knowledgePage.sources.errors.empty_site',
  internal: 'app.knowledgePage.sources.errors.internal',
};

/** Une source « en attente » depuis plus de 2 minutes : sans doute que le service de lecture (le worker) n'est pas démarré. */
const STALLED_MS = 2 * 60_000;

const safeUrl = (href: string): string | null => (/^https?:\/\//i.test(href) ? href : null);
const pathOf = (href: string): string => {
  try {
    const u = new URL(href);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return href;
  }
};

/** Un document ou un site : son état de lecture, ce qu'on en a tiré, ce qui a posé problème, et de quoi l'actualiser ou le supprimer. */
export function SourceCard({ item, canWrite, embeddings, demo }: { item: KnowledgeItem; canWrite: boolean; embeddings: boolean; demo: boolean }) {
  const t = useT();
  const router = useRouter();
  const now = useNow();
  const [busy, run] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [pages, setPages] = useState<KnowledgePage[] | null>(null);
  const [open, setOpen] = useState(false);

  const isSite = item.kind === 'website';
  const inQueue = item.status === 'pending' || item.status === 'processing';
  const reason = (code: string | null) => t(code && isSourceError(code) ? ERROR_KEYS[code] : 'app.knowledgePage.sources.errors.internal');
  const units = { b: t('app.units.b'), kb: t('app.units.kb'), mb: t('app.units.mb'), gb: t('app.units.gb') };
  const stalled = !demo && item.status === 'pending' && now !== null && now.getTime() - new Date(item.runAt ?? item.updatedAt).getTime() > STALLED_MS;
  const href = item.url ? safeUrl(item.url) : null;

  const refresh = () =>
    run(async () => {
      setProblem(null);
      const res = await requestSyncAction(item.id);
      if (res.ok) router.refresh();
      else setProblem(res.error);
    });
  const togglePages = () => {
    setOpen((v) => !v);
    if (pages === null) run(async () => setPages(await listPagesAction(item.id)));
  };

  const badge =
    item.status === 'processing' ? <Badge tone="lime">{t('app.knowledgePage.sources.status.processing')}</Badge>
    : item.status === 'pending' ? <Badge tone="warn">{t('app.knowledgePage.sources.status.pending')}</Badge>
    : item.status === 'failed' ? <Badge tone="danger">{t('app.knowledgePage.sources.status.failed')}</Badge>
    : item.chunkCount > 0 && item.embeddedAt === null && embeddings ? <Badge tone="warn">{t('app.knowledgePage.state.words')}</Badge>
    : <Badge tone="ok">{t('app.knowledgePage.sources.status.ready')}</Badge>;

  const s = item.stats;
  const warnings = [
    s.truncated && t('app.knowledgePage.sources.warnings.truncated'),
    s.timeLimit && t('app.knowledgePage.sources.warnings.timeLimit'),
    (s.spa ?? 0) > 0 && t('app.knowledgePage.sources.warnings.spa', { count: s.spa ?? 0 }),
    (s.robots ?? 0) > 0 && t('app.knowledgePage.sources.warnings.robots', { count: s.robots ?? 0 }),
    (s.failed ?? 0) > 0 && t('app.knowledgePage.sources.warnings.failed', { count: s.failed ?? 0 }),
  ].filter((w): w is string => typeof w === 'string');

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-wash text-muted">{isSite ? <GlobeIcon width={17} height={17} /> : <FileIcon width={17} height={17} />}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.title}</p>
            <p className="mt-0.5 truncate text-xs text-subtle">
              {isSite ? (href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">{item.url}</a> : item.url) : item.fileName}
              {!isSite && item.sizeBytes !== null && ` · ${formatBytes(t.locale, item.sizeBytes, units)}`}
            </p>
          </div>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-1.5">
            {!inQueue && (
              <button
                type="button" onClick={refresh} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
              >
                <RefreshIcon width={14} height={14} />{item.status === 'failed' ? t('app.knowledgePage.sources.retry') : t('app.knowledgePage.sources.refresh')}
              </button>
            )}
            <form action={deleteKnowledgeAction} onSubmit={(e) => { if (!window.confirm(t('app.knowledge.confirmDelete', { title: item.title }))) e.preventDefault(); }}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" aria-label={t('app.knowledge.delete')} title={t('app.knowledge.delete')} className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger"><TrashIcon width={15} height={15} /></button>
            </form>
          </div>
        )}
      </div>

      {item.status === 'ready' && item.content && <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted">{item.content}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {badge}
        {item.chunkCount > 0 && <span className="text-xs text-subtle">{t('app.knowledgePage.state.passages', { count: item.chunkCount })}</span>}
        {!isSite && s.pages !== undefined && <span className="text-xs text-subtle">{t('app.knowledgePage.sources.pdfPages', { count: s.pages })}</span>}
        {isSite && s.total !== undefined && item.chunkCount > 0 && <span className="text-xs text-subtle">{t('app.knowledgePage.sites.pagesRead', { count: s.total })}</span>}
        {item.syncedAt && now && <span className="text-xs text-subtle">{t('app.knowledgePage.sources.syncedAt', { when: formatRelative(t.locale, item.syncedAt, now, 'long') })}</span>}
        {isSite && item.autoSync && item.status === 'ready' && <span className="text-xs text-subtle">{t('app.knowledgePage.sources.weekly')}</span>}
        {isSite && item.chunkCount > 0 && (
          <button type="button" onClick={togglePages} aria-expanded={open} className="ms-auto text-xs font-semibold text-ink underline underline-offset-4 hover:text-black/70">
            {open ? t('app.knowledgePage.sites.hidePages') : t('app.knowledgePage.sites.showPages')}
          </button>
        )}
      </div>

      {item.status === 'failed' && <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium leading-relaxed text-danger">{reason(item.error)}</p>}
      {item.status === 'pending' && item.error && <p className="mt-2 text-xs leading-relaxed text-warn">{t('app.knowledgePage.sources.retrying', { reason: reason(item.error) })}</p>}
      {item.status === 'ready' && item.error && <p className="mt-2 text-xs leading-relaxed text-warn">{t('app.knowledgePage.sources.syncFailed', { reason: reason(item.error) })}</p>}
      {stalled && <p role="status" className="mt-2 rounded-xl bg-wash px-3 py-2 text-xs leading-relaxed text-muted">{t('app.knowledgePage.sources.stalled')}</p>}
      {item.status === 'ready' && warnings.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-0.5 text-xs leading-relaxed text-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {problem && <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{problem}</p>}

      {isSite && open && (
        <div className="mt-3 rounded-xl border border-line bg-paper p-3">
          {pages === null ? <p className="text-xs text-subtle">{t('app.knowledgePage.sites.pagesLoading')}</p> : pages.length === 0 ? <p className="text-xs text-subtle">{t('app.knowledgePage.sites.noPages')}</p> : (
            <ul className="grid grid-cols-1 gap-1.5">
              {pages.map((p) => {
                const link = safeUrl(p.url);
                return (
                  <li key={p.url} className="min-w-0 text-xs">
                    <span className="font-semibold">{p.title}</span>
                    <span className="text-subtle"> · {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">{pathOf(p.url)}</a> : pathOf(p.url)} · {t('app.knowledgePage.state.passages', { count: p.chunks })}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
