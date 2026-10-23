'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listMediaAction, type MediaListing } from '@/app/app/(shell)/medias/actions';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/client';
import { formatBytes } from '@/i18n/format';
import type { MediaItem } from '@/lib/data/types';
import { errorText } from '@/lib/form-error';
import { createClient } from '@/lib/supabase/client';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/env';
import { uploadMedia } from '@/lib/media/upload';
import { Lightbox, MediaThumb } from './media-thumb';

interface UploadRow { id: string; name: string; progress: number; error?: string }

function EmptyIllustration() {
  return (
    <svg width="170" height="130" viewBox="0 0 170 130" fill="none" aria-hidden="true">
      <rect x="22" y="38" width="58" height="58" rx="16" fill="#eef9c4" transform="rotate(-9 22 38)" />
      <rect x="62" y="34" width="72" height="72" rx="20" fill="#c6f432" />
      <circle cx="84" cy="58" r="6" fill="#111110" />
      <path d="m70 94 18-20 14 14 10-9 12 15H70Z" fill="#111110" />
    </svg>
  );
}

/**
 * Bibliothèque de médias : grille paginée avec recherche, envoi (bouton ou glisser-déposer, avec progression) et aperçu plein écran. Sert à deux
 * endroits : la page Médias (`manage` : la sélection sert à supprimer) et le sélecteur du composeur (`pick` : la sélection est jointe à la publication,
 * dans l'ordre où elle est faite). La sélection appartient au parent.
 */
export function MediaBrowser({
  mode, initial = null, userId, orgId, canWrite, demo, selection, onToggle, onUploaded, maxSelect, refreshKey = 0,
}: {
  mode: 'manage' | 'pick';
  initial?: MediaListing | null;
  orgId: string;
  userId: string;
  canWrite: boolean;
  demo: boolean;
  selection: MediaItem[];
  onToggle: (item: MediaItem) => void;
  /** Médias qui viennent d'être envoyés (déjà dans la bibliothèque) : le sélecteur les sélectionne d'office. */
  onUploaded?: (items: MediaItem[]) => void;
  /** Plafond de sélection (sélecteur) : au-delà, les autres médias sont grisés. */
  maxSelect?: number;
  /** Change pour demander un rechargement (après une suppression par le parent). */
  refreshKey?: number;
}) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [listing, setListing] = useState<MediaListing | null>(initial);
  const [page, setPage] = useState(initial?.page ?? 1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(initial === null);
  const [loadError, setLoadError] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const latest = useRef(0);
  const first = useRef(true);

  const load = useCallback(async (p: number, q: string): Promise<MediaListing | null> => {
    const ticket = ++latest.current;
    setLoading(true);
    setLoadError(false);
    let res: MediaListing | null = null;
    try {
      res = await listMediaAction({ page: p, search: q });
    } catch {
      res = null;
    }
    if (ticket !== latest.current) return res; // une demande plus récente est partie : on ignore celle-ci
    if (res) { setListing(res); setPage(res.page); } else setLoadError(true);
    setLoading(false);
    return res;
  }, []);

  // Recherche : on attend la fin de la frappe.
  useEffect(() => {
    const h = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  useEffect(() => {
    // Au premier rendu, la page déjà chargée par le serveur suffit ; on charge seulement quand il n'y en a pas, ou quand la recherche change.
    if (first.current) {
      first.current = false;
      if (initial !== null && query === '') return;
    }
    void load(1, query);
  }, [query, load, initial]);

  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    void load(page, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function upload(files: File[]) {
    if (demo || !canWrite || files.length === 0) return;
    const supabase = createClient();
    const rows = files.map((f) => ({ id: crypto.randomUUID(), file: f }));
    setUploads((cur) => [...cur, ...rows.map((r) => ({ id: r.id, name: r.file.name, progress: 0 }))]);
    const ids: string[] = [];
    for (const r of rows) {
      const out = await uploadMedia(supabase, {
        orgId, userId, file: r.file, supabaseUrl, anonKey: supabaseAnonKey,
        onProgress: (f) => setUploads((cur) => cur.map((u) => (u.id === r.id ? { ...u, progress: f } : u))),
      });
      if (out.ok) {
        ids.push(out.id);
        setUploads((cur) => cur.filter((u) => u.id !== r.id));
      } else {
        setUploads((cur) => cur.map((u) => (u.id === r.id ? { ...u, progress: 1, error: errorText(t, out.error) } : u)));
      }
    }
    if (ids.length > 0) {
      setSearch('');
      setQuery('');
      const res = await load(1, '');
      if (res && onUploaded) onUploaded(res.items.filter((m) => ids.includes(m.id)));
    }
  }

  const units = { b: t('app.units.b'), kb: t('app.units.kb'), mb: t('app.units.mb'), gb: t('app.units.gb') };
  const items = listing?.items ?? [];
  const total = listing?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (listing?.pageSize ?? 30)));
  const selectedIds = new Set(selection.map((s) => s.id));
  const full = mode === 'pick' && maxSelect !== undefined && selection.length >= maxSelect;
  const canUpload = canWrite && !demo;
  const searching = query !== '';
  const nothing = !loading && !loadError && total === 0;

  const picker = (
    <>
      <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files) void upload([...e.target.files]); e.target.value = ''; }} />
      {canUpload && <Button type="button" onClick={() => fileInput.current?.click()}>{t('app.media.upload')}</Button>}
    </>
  );

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col rounded-3xl ${drag ? 'outline-2 outline-dashed outline-ink' : ''}`}
      onDragOver={(e) => { if (canUpload) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canUpload) void upload([...e.dataTransfer.files]); }}
    >
      {demo && <p className="mb-3 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">{t('app.media.demoUploadOff')}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('app.media.searchPlaceholder')} aria-label={t('app.media.searchPlaceholder')}
          className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm outline-none placeholder:text-subtle focus:border-ink sm:max-w-xs"
        />
        <p className="text-sm text-muted" aria-live="polite">{t('app.media.count', { count: total })}</p>
        <span className="ms-auto">{picker}</span>
      </div>

      {uploads.length > 0 && (
        <ul className="mb-4 grid gap-2" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.id} className={`rounded-xl border px-3 py-2 text-sm ${u.error ? 'border-danger/30 bg-danger-soft text-danger' : 'border-line bg-surface'}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{u.name}</span>
                {u.error ? (
                  <button type="button" onClick={() => setUploads((cur) => cur.filter((x) => x.id !== u.id))} className="shrink-0 text-xs font-semibold underline underline-offset-4">{t('app.modal.close')}</button>
                ) : (
                  <span className="shrink-0 text-xs text-muted tabular-nums">{Math.round(u.progress * 100)} %</span>
                )}
              </div>
              {u.error ? <p className="mt-1 text-xs">{u.error}</p> : (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wash" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)} aria-label={u.name}>
                  <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${Math.max(4, u.progress * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {loadError && <p role="alert" className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{t('app.media.errList')}</p>}

      {nothing ? (
        <div className={`flex flex-1 flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-14 text-center transition ${drag ? 'border-ink bg-lime-soft/60' : 'border-line bg-surface'}`}>
          <EmptyIllustration />
          {searching ? (
            <p className="mt-5 text-[15px] text-muted">{t('app.media.noResults', { query })}</p>
          ) : (
            <>
              <p className="mt-6 text-xl font-semibold tracking-tight">{t('app.media.emptyTitle')}</p>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">{t('app.media.emptyText')}</p>
              <div className="mt-6">{picker}</div>
              {!canWrite && <p className="mt-4 text-sm text-muted">{t('app.media.viewerNote')}</p>}
            </>
          )}
        </div>
      ) : (
        <ul className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${mode === 'manage' ? 'lg:grid-cols-4 xl:grid-cols-5' : 'lg:grid-cols-4'} ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {items.map((m) => {
            const index = selection.findIndex((s) => s.id === m.id);
            const on = index >= 0;
            const blocked = !on && full;
            return (
              <li key={m.id} className={`group relative overflow-hidden rounded-2xl border bg-surface transition ${on ? 'border-ink ring-2 ring-ink' : 'border-line'} ${blocked ? 'opacity-45' : ''}`}>
                <button
                  type="button" onClick={() => onToggle(m)} disabled={blocked} aria-pressed={on} aria-label={t('app.media.select', { name: m.name })}
                  className="block w-full text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <span className="block aspect-square w-full"><MediaThumb item={m} /></span>
                  <span className="block truncate px-3 pt-2 text-sm font-semibold" title={m.name}>{m.name}</span>
                  <span className="block px-3 pb-2.5 text-xs text-subtle">{m.sizeBytes != null ? formatBytes(t.locale, m.sizeBytes, units) : ''}</span>
                </button>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute start-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full border text-xs font-bold ${on ? 'border-ink bg-ink text-white' : 'border-white/80 bg-ink/25 text-transparent'}`}
                >{on ? (mode === 'pick' ? index + 1 : '✓') : '✓'}</span>
                <button
                  type="button" onClick={() => setPreview(m)} aria-label={t('app.media.expand', { name: m.name })}
                  className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/65 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M8.5 2H12v3.5M5.5 12H2V8.5M12 2 8 6M2 12l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-5 flex items-center justify-center gap-3 text-sm" aria-label={t('app.media.pagination')}>
          <button type="button" disabled={page <= 1 || loading} onClick={() => void load(page - 1, query)} className="h-9 rounded-full border border-line px-4 font-semibold hover:border-ink disabled:opacity-40">{t('app.media.prev')}</button>
          <span className="text-muted tabular-nums">{t('app.media.pageOf', { page, pages })}</span>
          <button type="button" disabled={page >= pages || loading} onClick={() => void load(page + 1, query)} className="h-9 rounded-full border border-line px-4 font-semibold hover:border-ink disabled:opacity-40">{t('app.media.next')}</button>
        </nav>
      )}

      {preview && <Lightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
