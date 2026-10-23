import type { SupabaseClient } from '@supabase/supabase-js';
import type { FormError } from '@/lib/form-error';
import { safeFileName, validateMediaFile } from './logic';
import { kindOfMime } from './rules';
import { TUS_THRESHOLD_BYTES, tusUpload } from './tus';

// Envoi d'un média vers la bibliothèque, depuis le navigateur : le fichier part directement dans le stockage privé de l'organisation (la base et le
// stockage vérifient les droits), accompagné de ses dimensions, d'une vignette légère (grille de la bibliothèque) et, pour une image qui n'est pas
// en JPEG, d'une version JPEG : Instagram n'accepte que le JPEG.

export const THUMB_MAX_PX = 480;
export const JPEG_MAX_PX = 4096;

/** Instagram refuse tout sauf le JPEG : les autres images reçoivent une version JPEG. */
export const needsJpegRendition = (mime: string) => mime.startsWith('image/') && mime !== 'image/jpeg';

/** Réduit des dimensions pour tenir dans un carré de `max` pixels, sans jamais agrandir. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Chemins de stockage d'un média : le fichier, sa vignette et sa version JPEG partagent l'identifiant et le dossier de l'organisation. */
export function mediaPaths(orgId: string, uuid: string, fileName: string) {
  return {
    original: `${orgId}/${uuid}-${safeFileName(fileName)}`,
    thumb: `${orgId}/${uuid}-thumb.jpg`,
    jpeg: `${orgId}/${uuid}-instagram.jpg`,
  };
}

export interface Probe {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  thumb: Blob | null;
  jpeg: Blob | null;
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));

function drawn(source: CanvasImageSource, w: number, h: number, max: number): HTMLCanvasElement {
  const { width, height } = fitWithin(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // le JPEG n'a pas de transparence : fond blanc plutôt que noir
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function probeImage(file: File): Promise<Probe> {
  const empty: Probe = { width: null, height: null, durationSeconds: null, thumb: null, jpeg: null };
  try {
    const bitmap = await createImageBitmap(file);
    const out: Probe = { ...empty, width: bitmap.width, height: bitmap.height };
    out.thumb = await toJpeg(drawn(bitmap, bitmap.width, bitmap.height, THUMB_MAX_PX), 0.8);
    if (needsJpegRendition(file.type)) out.jpeg = await toJpeg(drawn(bitmap, bitmap.width, bitmap.height, JPEG_MAX_PX), 0.92);
    bitmap.close();
    return out;
  } catch {
    return empty; // format que le navigateur ne décode pas (HEIC hors Safari…) : on envoie quand même le fichier
  }
}

function probeVideo(file: File): Promise<Probe> {
  const empty: Probe = { width: null, height: null, durationSeconds: null, thumb: null, jpeg: null };
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (p: Probe) => { clearTimeout(timer); URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); resolve(p); };
    const timer = setTimeout(() => done(empty), 10_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onerror = () => done(empty);
    video.onloadedmetadata = () => {
      const base: Probe = { ...empty, width: video.videoWidth || null, height: video.videoHeight || null, durationSeconds: Number.isFinite(video.duration) ? video.duration : null };
      // Image de la vidéo : un peu après le début (la première image est souvent noire).
      video.onseeked = async () => {
        try {
          base.thumb = await toJpeg(drawn(video, video.videoWidth, video.videoHeight, THUMB_MAX_PX), 0.8);
        } catch {
          /* pas de vignette */
        }
        done(base);
      };
      try {
        video.currentTime = Math.min(1, Math.max(0, (video.duration || 0) * 0.1));
      } catch {
        done(base);
      }
    };
    video.src = url;
  });
}

export const probeFile = (file: File): Promise<Probe> => (kindOfMime(file.type) === 'video' ? probeVideo(file) : probeImage(file));

export type UploadOutcome = { ok: true; id: string } | { ok: false; error: FormError };

export async function uploadMedia(
  supabase: SupabaseClient,
  o: { orgId: string; userId: string; file: File; supabaseUrl: string; anonKey: string; onProgress?: (fraction: number) => void }
): Promise<UploadOutcome> {
  const { file } = o;
  const invalid = validateMediaFile(file);
  if (invalid) return { ok: false, error: invalid };

  const uuid = crypto.randomUUID();
  const paths = mediaPaths(o.orgId, uuid, file.name);
  const uploaded: string[] = [];
  const fail = async (key: 'app.media.errSend' | 'app.media.errSave'): Promise<UploadOutcome> => {
    if (uploaded.length > 0) await supabase.storage.from('media').remove(uploaded); // pas de fichier orphelin
    return { ok: false, error: { key, params: { name: file.name } } };
  };

  const probe = await probeFile(file);
  try {
    if (file.size > TUS_THRESHOLD_BYTES) {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return await fail('app.media.errSend');
      uploaded.push(paths.original);
      await tusUpload({
        endpoint: `${o.supabaseUrl}/storage/v1/upload/resumable`,
        headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: o.anonKey },
        bucket: 'media', objectName: paths.original, contentType: file.type, file,
        onProgress: (sent, total) => o.onProgress?.(sent / total),
      });
    } else {
      const up = await supabase.storage.from('media').upload(paths.original, file, { contentType: file.type, upsert: false });
      if (up.error) return await fail('app.media.errSend');
      uploaded.push(paths.original);
      o.onProgress?.(1);
    }
    const extras: { thumb?: string; jpeg?: string } = {};
    if (probe.thumb) {
      const t = await supabase.storage.from('media').upload(paths.thumb, probe.thumb, { contentType: 'image/jpeg', upsert: false });
      if (!t.error) { uploaded.push(paths.thumb); extras.thumb = paths.thumb; }
    }
    if (probe.jpeg) {
      const j = await supabase.storage.from('media').upload(paths.jpeg, probe.jpeg, { contentType: 'image/jpeg', upsert: false });
      if (!j.error) { uploaded.push(paths.jpeg); extras.jpeg = paths.jpeg; }
    }

    const ins = await supabase.from('media').insert({
      org_id: o.orgId, bucket: 'media', path: paths.original, name: file.name.slice(0, 255), mime_type: file.type, size_bytes: file.size,
      width: probe.width, height: probe.height, duration_seconds: probe.durationSeconds, status: 'ready',
      thumbnail_path: extras.thumb ?? null, normalized_path: extras.jpeg ?? null, created_by: o.userId,
    }).select('id').single();
    if (ins.error || !ins.data) return await fail('app.media.errSave');
    return { ok: true, id: ins.data.id as string };
  } catch {
    return await fail('app.media.errSend');
  }
}
