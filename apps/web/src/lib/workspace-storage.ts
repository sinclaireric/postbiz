import { createClient as createAdminClient } from '@supabase/supabase-js';
import { supabaseUrl } from '@/lib/supabase/env';

// Les fichiers d'un espace (médias, fiches de connaissance) vivent dans le stockage, sous « <espace>/… » : la suppression de l'espace en base ne les
// emporte pas. Cette étape les retire ensuite avec la clé de service (la session de la personne n'a plus aucun droit sur un espace supprimé).

export const WORKSPACE_BUCKETS = ['media', 'knowledge'] as const;
const PAGE = 100;
const MAX_FILES = 5000;
const MAX_DEPTH = 4;

interface Entry { name: string; id: string | null }
export interface BucketLike {
  list(path: string, options: { limit: number; offset: number }): Promise<{ data: Entry[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}
export interface StorageLike { from(bucket: string): BucketLike }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tous les fichiers sous un dossier (les sous-dossiers sont des entrées sans identifiant). */
async function filesUnder(bucket: BucketLike, folder: string, depth = 0, found: string[] = []): Promise<string[]> {
  for (let offset = 0; found.length < MAX_FILES; offset += PAGE) {
    const { data, error } = await bucket.list(folder, { limit: PAGE, offset });
    if (error) throw new Error('list');
    for (const entry of data ?? []) {
      const path = `${folder}/${entry.name}`;
      if (entry.id === null) {
        if (depth < MAX_DEPTH) await filesUnder(bucket, path, depth + 1, found);
      } else {
        found.push(path);
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return found;
}

/**
 * Retire tous les fichiers d'un espace supprimé. Ne touche qu'au dossier de cet identifiant (un identifiant mal formé est refusé : jamais de chemin
 * construit à partir d'autre chose qu'un UUID). Rend le nombre de fichiers retirés, ou `failed` si une liste ou une suppression a échoué.
 */
export async function purgeWorkspaceFiles(storage: StorageLike, orgId: string): Promise<{ removed: number; failed: boolean }> {
  if (!UUID.test(orgId)) return { removed: 0, failed: true };
  let removed = 0;
  let failed = false;
  for (const name of WORKSPACE_BUCKETS) {
    try {
      const bucket = storage.from(name);
      const paths = await filesUnder(bucket, orgId);
      for (let i = 0; i < paths.length; i += PAGE) {
        const batch = paths.slice(i, i + PAGE);
        const { error } = await bucket.remove(batch);
        if (error) failed = true;
        else removed += batch.length;
      }
    } catch {
      failed = true;
    }
  }
  return { removed, failed };
}

/** Avec la clé de service du serveur ; `null` si elle n'est pas configurée (les fichiers restent alors dans le stockage). */
export async function purgeWorkspaceFilesAsService(orgId: string): Promise<{ removed: number; failed: boolean } | null> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  const admin = createAdminClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return purgeWorkspaceFiles(admin.storage as unknown as StorageLike, orgId);
}
