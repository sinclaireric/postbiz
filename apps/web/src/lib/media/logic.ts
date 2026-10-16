/** 1 Gio : limite du bucket « media » (voir la migration 20261016000003_engine.sql). */
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

/** Images et vidéos uniquement, dans la limite de taille. Renvoie un message d'erreur, sinon `null`. */
export function validateMediaFile(f: FileLike): string | null {
  if (!/^(image|video)\//.test(f.type)) return `« ${f.name} » n’est pas une image ni une vidéo.`;
  if (f.size <= 0) return `« ${f.name} » est vide.`;
  if (f.size > MAX_MEDIA_BYTES) return `« ${f.name} » dépasse 1 Go.`;
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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} Mo`;
  return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
}
