import type { SupabaseClient } from '@supabase/supabase-js';
import { FILE_TYPES, SOURCE_LIMITS, fileExtension } from '@postbiz/kb';
import type { FormError } from '@/lib/form-error';
import { safeFileName } from '@/lib/media/logic';

// Envoi d'un document vers la base de connaissance, depuis le navigateur : le fichier part directement dans le stockage privé de l'organisation (dossier « <organisation>/ »,
// bucket « knowledge » : la base et le stockage vérifient les droits), puis `registerDocumentAction` l'enregistre et le worker le lit.

const MAX_MB = Math.round(SOURCE_LIMITS.fileBytes / 1_048_576);

/** Ce qu'on peut vérifier avant l'envoi : le type (par l'extension), la taille. */
export function validateDocumentFile(file: File): FormError | null {
  if (!fileExtension(file.name)) return { key: 'app.knowledgePage.errors.unsupportedType' };
  if (file.size === 0) return { key: 'app.knowledgePage.errors.fileMissing' };
  if (file.size > SOURCE_LIMITS.fileBytes) return { key: 'app.knowledgePage.errors.fileTooLarge', params: { max: MAX_MB } };
  return null;
}

/** Le chemin d'un document dans le stockage : « <organisation>/<identifiant>-<nom sûr> » (jamais deux points de suite : la base les refuse). */
export const documentPath = (orgId: string, uuid: string, fileName: string) => `${orgId}/${uuid}-${safeFileName(fileName).replace(/\.{2,}/g, '.')}`;

export type UploadResult = { ok: true; path: string } | { ok: false; error: FormError };

export async function uploadDocument(supabase: SupabaseClient, o: { orgId: string; file: File }): Promise<UploadResult> {
  const invalid = validateDocumentFile(o.file);
  if (invalid) return { ok: false, error: invalid };
  const ext = fileExtension(o.file.name)!;
  const path = documentPath(o.orgId, crypto.randomUUID(), o.file.name);
  const up = await supabase.storage.from('knowledge').upload(path, o.file, { contentType: FILE_TYPES[ext], upsert: false });
  return up.error ? { ok: false, error: { key: 'app.knowledgePage.errors.uploadFailed' } } : { ok: true, path };
}
