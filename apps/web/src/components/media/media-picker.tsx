'use client';

import { useState } from 'react';
import { Modal } from '@/components/app/modal';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { MediaItem } from '@/lib/data/types';
import { MediaBrowser } from './media-browser';

/**
 * Fenêtre « Choisir des médias » du composeur : la bibliothèque de l'organisation, avec envoi sur place. On clique pour sélectionner ; l'ordre de
 * sélection devient l'ordre dans la publication. Un média qu'on vient d'envoyer est sélectionné d'office.
 * `slots` : combien de médias on peut encore ajouter (les médias déjà joints comptent dans la limite du composeur).
 */
export function MediaPicker({
  onClose, onConfirm, orgId, userId, canWrite, demo, slots, excludeIds = [],
}: {
  onClose: () => void;
  onConfirm: (items: MediaItem[]) => void;
  orgId: string;
  userId: string;
  canWrite: boolean;
  demo: boolean;
  slots: number;
  /** Médias déjà joints à la publication : ils ne se joignent pas deux fois. */
  excludeIds?: string[];
}) {
  const t = useT();
  const [selection, setSelection] = useState<MediaItem[]>([]);
  const room = Math.max(0, slots);

  const toggle = (item: MediaItem) => {
    if (excludeIds.includes(item.id)) return;
    setSelection((cur) => (cur.some((s) => s.id === item.id) ? cur.filter((s) => s.id !== item.id) : cur.length >= room ? cur : [...cur, item]));
  };
  const uploaded = (items: MediaItem[]) =>
    setSelection((cur) => [...cur, ...items.filter((m) => !cur.some((s) => s.id === m.id) && !excludeIds.includes(m.id))].slice(0, room));

  return (
    <Modal title={t('app.media.pickTitle')} onClose={onClose} width="max-w-4xl" closeOnBackdrop={false}>
      <p className="-mt-2 mb-4 text-sm text-muted">{t('app.media.pickHint')}</p>
      <div className="flex min-h-[22rem] flex-col">
        <MediaBrowser
          mode="pick" orgId={orgId} userId={userId} canWrite={canWrite} demo={demo}
          selection={selection} onToggle={toggle} onUploaded={uploaded} maxSelect={room}
        />
      </div>
      <div className="sticky -bottom-6 -mx-6 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-6 py-4">
        <p className="text-sm text-muted" aria-live="polite">
          {room === 0 ? t('app.media.limitReached') : t('app.media.selected', { count: selection.length })}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('app.media.cancel')}</Button>
          <Button type="button" disabled={selection.length === 0} onClick={() => { onConfirm(selection); onClose(); }}>{t('app.media.insert', { count: selection.length })}</Button>
        </div>
      </div>
    </Modal>
  );
}
