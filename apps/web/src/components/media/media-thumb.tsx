'use client';

import { useEffect } from 'react';
import { useT } from '@/i18n/client';
import type { MediaItem } from '@/lib/data/types';

/** 83 → « 1:23 ». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Thumbable = Pick<MediaItem, 'kind' | 'url' | 'thumbUrl' | 'name'> & { durationSeconds?: number | null };

/**
 * Vignette d'un média : la vignette légère si elle existe, sinon l'image elle-même ; pour une vidéo sans vignette, sa première image.
 * Un petit bouton ▶ et la durée distinguent les vidéos. Remplit son conteneur (à lui de donner la forme).
 */
export function MediaThumb({ item, showDuration = true, className = '' }: { item: Thumbable; showDuration?: boolean; className?: string }) {
  const t = useT();
  const still = item.thumbUrl ?? (item.kind === 'image' ? item.url : null);
  return (
    <span className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-wash ${className}`}>
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire du stockage
        <img src={still} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      ) : item.kind === 'video' && item.url ? (
        <video src={item.url} preload="metadata" muted playsInline aria-hidden="true" className="h-full w-full bg-ink object-cover" />
      ) : (
        <span className="px-2 text-center text-xs text-subtle">{t('app.media.noPreview')}</span>
      )}
      {item.kind === 'video' && (
        <>
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/65 text-white"><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M4 2.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4a.6.6 0 0 0-.9.5Z" /></svg></span>
          </span>
          {showDuration && item.durationSeconds != null && (
            <span className="absolute end-1.5 bottom-1.5 rounded-md bg-ink/70 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">{formatDuration(item.durationSeconds)}</span>
          )}
        </>
      )}
    </span>
  );
}

/**
 * Aperçu plein écran d'un média. Posé au-dessus de la fenêtre qui l'ouvre : son Échap (en phase de capture) ferme l'aperçu seul, sans fermer
 * la fenêtre en dessous.
 */
export function Lightbox({ item, onClose }: { item: Pick<MediaItem, 'kind' | 'url' | 'thumbUrl' | 'name' | 'alt'>; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/85 p-4" role="dialog" aria-modal="true" aria-label={item.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button type="button" onClick={onClose} aria-label={t('app.media.closePreview')} className="absolute end-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25">
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      {item.kind === 'video' && item.url ? (
        <video src={item.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-xl bg-ink" />
      ) : item.url || item.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire du stockage
        <img src={(item.url ?? item.thumbUrl)!} alt={item.alt || item.name} className="max-h-full max-w-full rounded-xl object-contain" />
      ) : (
        <p className="text-white">{t('app.media.noPreview')}</p>
      )}
    </div>
  );
}
