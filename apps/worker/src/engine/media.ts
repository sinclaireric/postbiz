import type { ResolvedMedia } from '../providers/types.ts';

// Médias d'une publication : `posts.media` ne garde que des références ([{ media_id, type, alt }]) ; au moment de publier, le worker relit la
// bibliothèque et signe des URL temporaires. Ce module est la partie pure (sans base ni stockage), pour pouvoir la tester.

/** Durée de validité des URL signées : assez pour qu'un réseau télécharge une vidéo, pas plus. */
export const MEDIA_URL_TTL_SECONDS = 2 * 3600;

/** Un média référencé par une publication n'existe plus ou n'est pas utilisable : rien n'est publié, l'utilisateur doit le retirer. */
export class MediaUnavailableError extends Error {
  constructor(message = 'Un média de la publication n’existe plus dans la bibliothèque : retirez-le puis reprogrammez.') {
    super(message);
    this.name = 'MediaUnavailableError';
  }
}

export interface MediaRef { id: string; alt: string | null }

export interface MediaRow {
  id: string;
  org_id: string;
  bucket: string;
  path: string;
  name: string | null;
  mime_type: string | null;
  kind: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | string | null;
  alt: string | null;
  thumbnail_path: string | null;
  normalized_path: string | null;
}

/** Références de médias d'une publication, dans l'ordre. Ce qui n'a pas la bonne forme est ignoré (la base impose déjà la forme). */
export function parseMediaRefs(raw: unknown): MediaRef[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaRef[] = [];
  for (const item of raw) {
    const id = (item as { media_id?: unknown } | null)?.media_id;
    if (typeof id !== 'string' || id === '') continue;
    const alt = (item as { alt?: unknown }).alt;
    out.push({ id, alt: typeof alt === 'string' && alt.trim() ? alt.trim() : null });
  }
  return out;
}

/** Un fichier n'est utilisable que dans le bucket « media » et dans le dossier de l'organisation de la publication (défense en plus de la base). */
const inFolder = (path: string | null, orgId: string) => !!path && path.startsWith(`${orgId}/`) && !path.includes('..');

/**
 * Associe références et lignes de la bibliothèque.
 * `dryRun` : ne renvoie que les chemins à signer (et vérifie déjà les lignes) ; sinon renvoie les médias résolus avec leurs URL signées.
 */
export function buildResolvedMedia(refs: MediaRef[], rows: MediaRow[], urls: Map<string, string>, orgId: string, opts: { dryRun: true }): string[];
export function buildResolvedMedia(refs: MediaRef[], rows: MediaRow[], urls: Map<string, string>, orgId: string): ResolvedMedia[];
export function buildResolvedMedia(refs: MediaRef[], rows: MediaRow[], urls: Map<string, string>, orgId: string, opts?: { dryRun: true }): ResolvedMedia[] | string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ResolvedMedia[] = [];
  const paths = new Set<string>();
  for (const ref of refs) {
    const row = byId.get(ref.id);
    if (!row || row.org_id !== orgId || row.bucket !== 'media' || !inFolder(row.path, orgId)) throw new MediaUnavailableError();
    const extras = [row.thumbnail_path, row.normalized_path].map((p) => (inFolder(p, orgId) ? p : null));
    paths.add(row.path);
    for (const p of extras) if (p) paths.add(p);
    if (opts?.dryRun) continue;

    const url = urls.get(row.path);
    if (!url) throw new MediaUnavailableError(`Le fichier « ${row.name ?? row.path} » est introuvable dans le stockage : retirez-le puis reprogrammez.`);
    out.push({
      id: row.id,
      kind: row.kind === 'video' ? 'video' : 'image',
      name: row.name ?? row.path.split('/').pop() ?? row.id,
      mimeType: row.mime_type,
      alt: ref.alt ?? (row.alt ?? '').trim(),
      url,
      jpegUrl: extras[1] ? urls.get(extras[1]) ?? null : null,
      thumbnailUrl: extras[0] ? urls.get(extras[0]) ?? null : null,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    });
  }
  return opts?.dryRun ? [...paths] : out;
}
