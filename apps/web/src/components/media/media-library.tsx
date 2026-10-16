'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui';
import type { MediaItem } from '@/lib/data/types';
import { createClient } from '@/lib/supabase/client';
import { displayName, formatBytes, storagePath, validateMediaFile } from '@/lib/media/logic';

interface LocalItem { id: string; name: string; type: string; size: number; url: string }

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

export function MediaLibrary({ items, orgId, canWrite, demo }: { items: MediaItem[]; orgId: string; canWrite: boolean; demo: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [local, setLocal] = useState<LocalItem[]>([]);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    const problems = list.map(validateMediaFile).filter((e): e is string => !!e);
    const valid = list.filter((f) => !validateMediaFile(f));
    setErrors(problems);
    if (valid.length === 0) return;

    if (demo) {
      // Mode démo : simple aperçu local, rien n'est enregistré.
      setLocal((cur) => [...valid.map((f) => ({ id: crypto.randomUUID(), name: f.name, type: f.type, size: f.size, url: URL.createObjectURL(f) })), ...cur]);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const failed: string[] = [];
    for (const f of valid) {
      const path = storagePath(orgId, crypto.randomUUID(), f.name);
      const up = await supabase.storage.from('media').upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) { failed.push(`« ${f.name} » n’a pas pu être envoyé.`); continue; }
      const ins = await supabase.from('media').insert({ org_id: orgId, bucket: 'media', path, mime_type: f.type, size_bytes: f.size, created_by: auth.user?.id });
      if (ins.error) {
        await supabase.storage.from('media').remove([path]); // pas de fichier orphelin
        failed.push(`« ${f.name} » n’a pas pu être enregistré.`);
      }
    }
    setErrors((e) => [...e, ...failed]);
    setBusy(false);
    router.refresh();
  }

  async function remove(item: MediaItem) {
    if (!window.confirm(`Supprimer « ${displayName(item.path)} » ?`)) return;
    const supabase = createClient();
    const del = await supabase.from('media').delete().eq('id', item.id);
    if (del.error) { setErrors(['La suppression a échoué.']); return; }
    await supabase.storage.from('media').remove([item.path]);
    router.refresh();
  }

  const total = items.length + local.length;
  const picker = (
    <>
      <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }} />
      {canWrite && <Button type="button" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Envoi en cours…' : '+ Téléverser'}</Button>}
    </>
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col p-5 sm:p-7"
      onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canWrite) void upload(e.dataTransfer.files); }}
    >
      {demo && <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">Mode démo : les fichiers sont seulement prévisualisés dans votre navigateur, rien n’est enregistré.</p>}
      {errors.length > 0 && (
        <ul role="alert" className="mb-4 grid gap-1 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}

      {total === 0 ? (
        <div className={`flex flex-1 flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-16 text-center transition ${drag ? 'border-ink bg-lime-soft/60' : 'border-line bg-surface'}`}>
          <EmptyIllustration />
          <p className="mt-6 text-xl font-semibold tracking-tight">Vous n’avez pas encore de média</p>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">Sélectionnez ou téléversez des images et des vidéos (1 Go maximum par fichier). Vous pouvez aussi les glisser-déposer ici.</p>
          <div className="mt-6">{picker}</div>
          {!canWrite && <p className="mt-4 text-sm text-muted">Votre rôle (lecteur) ne permet pas de téléverser des médias.</p>}
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">{total} média{total > 1 ? 's' : ''}</p>
            {picker}
          </div>
          <ul className={`grid grid-cols-2 gap-4 rounded-3xl sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${drag ? 'outline-2 outline-dashed outline-ink' : ''}`}>
            {local.map((m) => (
              <li key={m.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <Thumb url={m.url} type={m.type} name={m.name} />
                <p className="truncate px-3 pt-2 text-sm font-semibold" title={m.name}>{m.name}</p>
                <p className="px-3 pb-3 text-xs text-subtle">{formatBytes(m.size)} · aperçu local</p>
              </li>
            ))}
            {items.map((m) => (
              <li key={m.id} className="group relative overflow-hidden rounded-2xl border border-line bg-surface">
                <Thumb url={m.url} type={m.mimeType ?? ''} name={displayName(m.path)} />
                <p className="truncate px-3 pt-2 text-sm font-semibold" title={displayName(m.path)}>{displayName(m.path)}</p>
                <p className="px-3 pb-3 text-xs text-subtle">{m.sizeBytes != null ? formatBytes(m.sizeBytes) : ''}</p>
                {canWrite && (
                  <button type="button" onClick={() => void remove(m)} aria-label={`Supprimer ${displayName(m.path)}`} className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 4h8M5.5 4V2.8h3V4M4.5 4l.4 7h4.2l.4-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Thumb({ url, type, name }: { url: string | null; type: string; name: string }) {
  const box = 'flex aspect-square w-full items-center justify-center bg-wash text-xs text-subtle';
  if (!url) return <div className={box}>Aperçu indisponible</div>;
  if (type.startsWith('video/')) return <video src={url} preload="metadata" muted playsInline className="aspect-square w-full bg-ink object-cover" aria-label={name} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} loading="lazy" className="aspect-square w-full object-cover" />;
}
