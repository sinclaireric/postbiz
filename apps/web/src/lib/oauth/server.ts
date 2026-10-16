import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { siteUrl, supabaseUrl } from '@/lib/supabase/env';
import type { FlowDeps } from './flow';
import { createSupabaseOAuthStore } from './store';

/**
 * Dépendances réelles du flux (côté serveur uniquement : utilise SUPABASE_SERVICE_ROLE_KEY).
 * Renvoie `null` si le serveur n'est pas configuré pour stocker des jetons.
 */
export function createFlowDeps(): FlowDeps | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!supabaseUrl || !serviceKey || !encryptionKey) return null;
  const admin = createAdminClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    store: createSupabaseOAuthStore(admin),
    env: process.env,
    fetch,
    siteUrl,
    encryptionKey,
    // Le rôle est lu avec la session de l'utilisateur (soumise à la RLS), pas avec la clé de service.
    async isAdmin(userId, orgId) {
      const supabase = await createClient();
      const { data } = await supabase.from('memberships').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
      return data?.role === 'admin';
    },
    log: (msg) => console.error(`[oauth] ${msg}`),
  };
}
