'use client';

import { useState } from 'react';
import { deleteMediaAction, type MediaListing } from '@/app/app/(shell)/medias/actions';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { MediaItem } from '@/lib/data/types';
import { MediaBrowser } from './media-browser';

/** Page Médias : la bibliothèque de l'organisation. Sélectionner des médias permet de les supprimer ; l'envoi se fait ici ou depuis le composeur. */
export function MediaLibrary({ initial, orgId, userId, canWrite, demo }: { initial: MediaListing; orgId: string; userId: string; canWrite: boolean; demo: boolean }) {
  const t = useT();
  const [selection, setSelection] = useState<MediaItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'warn'; text: string } | null>(null);

  const toggle = (item: MediaItem) => setSelection((cur) => (cur.some((s) => s.id === item.id) ? cur.filter((s) => s.id !== item.id) : [...cur, item]));

  async function removeSelected() {
    if (selection.length === 0 || busy) return;
    if (!window.confirm(t('app.media.confirmDeleteMany', { count: selection.length }))) return;
    setBusy(true);
    setMessage(null);
    const res = await deleteMediaAction(selection.map((s) => s.id));
    setBusy(false);
    if ('error' in res) { setMessage({ tone: 'error', text: t('app.media.errDelete') }); return; }
    if (res.blocked.length > 0) setMessage({ tone: 'warn', text: t('app.media.blocked', { count: res.blocked.length }) });
    setSelection([]);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-5 sm:p-7">
      {selection.length > 0 && canWrite && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5" role="status">
          <span className="text-sm font-semibold">{t('app.media.selected', { count: selection.length })}</span>
          <button type="button" onClick={() => setSelection([])} className="text-sm text-muted underline underline-offset-4 hover:text-ink">{t('app.media.clearSelection')}</button>
          <Button type="button" variant="secondary" size="sm" className="ms-auto !text-danger" onClick={() => void removeSelected()} disabled={busy}>{t('app.media.deleteSelected')}</Button>
        </div>
      )}
      {message && <p role="alert" className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${message.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>{message.text}</p>}
      <MediaBrowser
        mode="manage" initial={initial} orgId={orgId} userId={userId} canWrite={canWrite} demo={demo}
        selection={canWrite ? selection : []} onToggle={canWrite ? toggle : () => {}} refreshKey={refreshKey}
      />
    </div>
  );
}
