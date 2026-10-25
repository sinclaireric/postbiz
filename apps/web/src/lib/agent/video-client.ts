import type { AgentMedia, AgentVideoJob, VideoJobResponse } from './types';

/** Le navigateur interroge une vidéo en cours toutes les dix secondes (la route est limitée à 40 interrogations par minute et par personne). */
export const VIDEO_POLL_MS = 10_000;

const isString = (v: unknown): v is string => typeof v === 'string';

function readJob(v: unknown): AgentVideoJob | null {
  if (typeof v !== 'object' || v === null) return null;
  const j = v as Record<string, unknown>;
  if (!isString(j.id) || !isString(j.prompt) || !isString(j.createdAt)) return null;
  if (j.status !== 'pending' && j.status !== 'completed' && j.status !== 'failed') return null;
  if (j.orientation !== 'vertical' && j.orientation !== 'horizontal') return null;
  if (j.mediaId !== null && !isString(j.mediaId)) return null;
  if (j.error !== null && !isString(j.error)) return null;
  return { id: j.id, status: j.status, orientation: j.orientation, prompt: j.prompt, mediaId: j.mediaId, error: j.error, createdAt: j.createdAt };
}

function readMedia(v: unknown): AgentMedia | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  if (!isString(m.id) || !isString(m.name) || (m.kind !== 'image' && m.kind !== 'video')) return undefined;
  const nullableString = (x: unknown) => (isString(x) ? x : null);
  return { id: m.id, kind: m.kind, name: m.name, alt: isString(m.alt) ? m.alt : '', url: nullableString(m.url), thumbUrl: nullableString(m.thumbUrl), durationSeconds: typeof m.durationSeconds === 'number' ? m.durationSeconds : null };
}

/** Lit la réponse de la route (donnée non fiable : une réponse abîmée, ou une page d'erreur, donne null). */
export function parseVideoJobResponse(raw: unknown): VideoJobResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const job = readJob(r.job);
  const media = readMedia(r.media);
  if (!job || media === undefined || (r.url !== null && !isString(r.url))) return null;
  return { job, media, url: r.url };
}

/** Interroge une vidéo (ce qui la fait avancer côté serveur). Null en cas d'erreur réseau ou de réponse inattendue : l'appelant réessaiera. */
export async function fetchVideoJob(id: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<VideoJobResponse | null> {
  try {
    const res = await fetcher(`/api/agent/video/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    return parseVideoJobResponse(await res.json());
  } catch {
    return null;
  }
}
