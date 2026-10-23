'use client';

import { useState } from 'react';
import { MediaThumb } from '@/components/media/media-thumb';
import { useT } from '@/i18n/client';
import type { MediaItem } from '@/lib/data/types';
import { ALT_MAX } from '@/lib/media/logic';
import { PlusIcon, TrashIcon } from './composer-icons';

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]!);
  return next;
};

/**
 * Médias joints à la publication : vignettes dans l'ordre d'envoi, à réordonner (glisser-déposer, ou boutons pour le clavier), à retirer, avec un
 * texte alternatif par média. Les modifications se font sur la copie de la publication : la bibliothèque n'est pas touchée.
 */
export function MediaStrip({ items, onChange, onAdd, disabled, max }: { items: MediaItem[]; onChange: (items: MediaItem[]) => void; onAdd: () => void; disabled?: boolean; max: number }) {
  const t = useT();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editedItem = items.find((m) => m.id === editing) ?? null;

  const iconBtn = 'flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-white transition hover:bg-ink disabled:opacity-30';

  return (
    <div className="mt-3">
      <ul className="flex flex-wrap items-start gap-2.5">
        {items.map((m, i) => (
          <li
            key={m.id}
            draggable={!disabled}
            onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); }}
            onDragOver={(e) => { if (dragging !== null) { e.preventDefault(); setOver(i); } }}
            onDrop={(e) => { e.preventDefault(); if (dragging !== null) onChange(move(items, dragging, i)); setDragging(null); setOver(null); }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            className={`group relative h-24 w-24 overflow-hidden rounded-xl border bg-wash ${over === i && dragging !== i ? 'border-ink ring-2 ring-ink' : 'border-line'} ${dragging === i ? 'opacity-40' : ''} ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
          >
            <MediaThumb item={m} showDuration />
            <span className="pointer-events-none absolute start-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink/70 px-1 text-[11px] font-bold text-white tabular-nums">{i + 1}</span>
            <button
              type="button" disabled={disabled} onClick={() => onChange(items.filter((x) => x.id !== m.id))} aria-label={t('app.composer.removeMedia', { name: m.name })}
              title={t('app.composer.removeMedia', { name: m.name })} className={`absolute end-1.5 top-1.5 ${iconBtn}`}
            ><TrashIcon width={12} height={12} /></button>
            <span className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              <button type="button" disabled={disabled || i === 0} onClick={() => onChange(move(items, i, i - 1))} aria-label={t('app.composer.moveBefore', { name: m.name })} className={iconBtn}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="rtl:rotate-180"><path d="M8 2 4 6l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button
                type="button" disabled={disabled} onClick={() => setEditing(editing === m.id ? null : m.id)} aria-expanded={editing === m.id} aria-label={t('app.composer.altEdit', { name: m.name })}
                className={`h-6 rounded-full px-2 text-[10px] font-bold tracking-wide ${m.alt.trim() ? 'bg-lime text-ink' : 'bg-ink/70 text-white'}`}
              >ALT</button>
              <button type="button" disabled={disabled || i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))} aria-label={t('app.composer.moveAfter', { name: m.name })} className={iconBtn}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="rtl:rotate-180"><path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </span>
          </li>
        ))}
        {items.length < max && (
          <li>
            <button
              type="button" disabled={disabled} onClick={onAdd}
              className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-xs font-semibold text-muted transition hover:border-ink hover:text-ink disabled:pointer-events-none disabled:opacity-50"
            ><PlusIcon width={18} height={18} />{t('app.composer.addMediaShort')}</button>
          </li>
        )}
      </ul>

      {editedItem && (
        <div className="mt-3 rounded-2xl border border-line bg-paper p-3">
          <label htmlFor="media-alt" className="text-sm font-semibold">{t('app.composer.altLabel', { name: editedItem.name })}</label>
          <textarea
            id="media-alt" value={editedItem.alt} maxLength={ALT_MAX} rows={2} disabled={disabled} placeholder={t('app.composer.altPlaceholder')}
            onChange={(e) => onChange(items.map((m) => (m.id === editedItem.id ? { ...m, alt: e.target.value } : m)))}
            className="mt-1.5 block w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-subtle">{t('app.composer.altHint')}</p>
            <button type="button" onClick={() => setEditing(null)} className="shrink-0 text-sm font-semibold underline underline-offset-4">{t('app.composer.altDone')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
