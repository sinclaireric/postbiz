import type { FormError } from '@/lib/form-error';

/** 1 Gio : limite du bucket « media » (voir la migration 20261016000003_engine.sql). */
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

/** Images et vidéos uniquement, dans la limite de taille. Renvoie une erreur (clé de message), sinon `null`. */
export function validateMediaFile(f: FileLike): FormError | null {
  if (!/^(image|video)\//.test(f.type)) return { key: 'app.validation.notMedia', params: { name: f.name } };
  if (f.size <= 0) return { key: 'app.validation.fileEmpty', params: { name: f.name } };
  if (f.size > MAX_MEDIA_BYTES) return { key: 'app.validation.fileTooBig', params: { name: f.name } };
  return null;
}

/** Nom de fichier sûr pour un chemin de stockage : sans accents, espaces ni caractères spéciaux. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  const dot = cleaned.lastIndexOf('.');
  const base = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 80).replace(/[-.]+$/, '') || 'fichier';
  const ext = dot > 0 ? cleaned.slice(dot + 1).slice(0, 10).toLowerCase() : '';
  return ext ? `${base}.${ext}` : base;
}

/** Convention de chemin imposée par les policies de stockage : `{org_id}/{fichier}`. */
export const storagePath = (orgId: string, uuid: string, fileName: string) => `${orgId}/${uuid}-${safeFileName(fileName)}`;

/** Nom d'affichage : retire le préfixe d'identifiant ajouté au chemin. */
export const displayName = (path: string) => path.split('/').pop()!.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, '');
