'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FILE_ACCEPT, titleFromFileName } from '@postbiz/kb';
import { registerDocumentAction } from '@/app/app/(shell)/connaissances/actions';
import { PlusIcon } from '@/components/calendar/composer-icons';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { KNOWLEDGE_LIMITS, type KnowledgeItem, type KnowledgeLimits } from '@/lib/data/types';
import { createClient } from '@/lib/supabase/client';
import { uploadDocument, validateDocumentFile } from '@/lib/knowledge-upload';
import { LimitNote } from './limit-note';
import { SourceCard } from './source-card';

/** Les documents (PDF avec texte, Word, texte, Markdown, CSV, HTML) : envoyés dans le stockage de l'organisation, lus ensuite par le worker. */
export function DocumentsPanel({ items, total, limits, canWrite, demo, orgId, embeddings }: { items: KnowledgeItem[]; total: number; limits: KnowledgeLimits; canWrite: boolean; demo: boolean; orgId: string; embeddings: boolean }) {
  const t = useT();
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const full = items.length >= limits.files || total >= limits.sources;

  /** Envoie un fichier ; rend le message d'erreur à montrer, ou null si tout s'est bien passé. */
  async function sendOne(file: File): Promise<string | null> {
    const invalid = validateDocumentFile(file);
    if (invalid) return t(invalid.key, invalid.params);
    try {
      if (demo) {
        // Sans stockage ni worker : le serveur de démonstration lit le fichier tout de suite.
        const body = new FormData();
        body.set('file', file);
        const res = await fetch('/api/knowledge/demo-upload', { method: 'POST', body });
        const out = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
        return out?.ok ? null : (out?.error ?? t('app.knowledgePage.errors.uploadFailed'));
      }
      const supabase = createClient();
      const up = await uploadDocument(supabase, { orgId, file });
      if (!up.ok) return t(up.error.key, up.error.params);
      const saved = await registerDocumentAction({ path: up.path, title: titleFromFileName(file.name), size: file.size });
      if (!saved.ok) {
        await supabase.storage.from('knowledge').remove([up.path]); // pas de fichier orphelin
        return saved.error;
      }
      return null;
    } catch {
      return t('app.knowledgePage.errors.uploadFailed');
    }
  }

  async function send(files: File[]) {
    setProblems([]);
    const failed: string[] = [];
    for (const file of files) {
      setSending(file.name);
      const error = await sendOne(file);
      if (error) failed.push(`« ${file.name} » : ${error}`);
    }
    setSending(null);
    setProblems(failed);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{t('app.knowledgePage.tabs.documents')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t('app.knowledgePage.docs.hint', { max: Math.round(KNOWLEDGE_LIMITS.fileBytes / 1_048_576) })}</p>
        </div>
        <input
          ref={picker} type="file" multiple accept={FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-label={t('app.knowledgePage.docs.add')}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = ''; // pour pouvoir renvoyer le même fichier
            if (files.length > 0) void send(files);
          }}
        />
        <Button type="button" size="sm" variant="secondary" disabled={!canWrite || full || sending !== null} onClick={() => picker.current?.click()}>
          <PlusIcon width={15} height={15} />{t('app.knowledgePage.docs.add')}
        </Button>
      </div>

      {demo && <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">{t('app.knowledgePage.docs.demoNote')}</p>}
      {!canWrite && <p className="text-xs text-muted">{t('app.knowledge.viewerNote')}</p>}
      {canWrite && full && <LimitNote message={total >= limits.sources ? t('app.knowledge.errLimit', { max: limits.sources }) : t('app.knowledgePage.errors.filesLimit', { max: limits.files })} upgradable={limits.upgradable} />}
      {sending && <p role="status" className="rounded-xl bg-wash px-3 py-2 text-sm text-muted">{t('app.knowledgePage.docs.uploading', { name: sending })}</p>}
      {problems.length > 0 && (
        <ul role="alert" className="grid grid-cols-1 gap-1 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl bg-wash px-4 py-6 text-center text-sm text-muted">{t('app.knowledgePage.docs.empty')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5">{items.map((item) => <SourceCard key={item.id} item={item} canWrite={canWrite} embeddings={embeddings} demo={demo} />)}</ul>
      )}
    </div>
  );
}
