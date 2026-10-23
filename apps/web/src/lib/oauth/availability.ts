import { familyForNetwork, missingEnv, type Env } from '@postbiz/core';
import { APP_NETWORKS } from '@/lib/networks';

export interface Availability {
  available: boolean;
  /** Ce qu'il manque, en clair, pour l'administrateur : noms de variables, jamais de valeurs. */
  missing: string[];
}

function validKey(k: string | undefined): boolean {
  if (!k) return false;
  try {
    return atob(k).length === 32;
  } catch {
    return false;
  }
}

/**
 * Un réseau n'est connectable que si le serveur a de quoi stocker les jetons (clé de service Supabase +
 * clé de chiffrement) ET les identifiants de l'application du réseau. Sinon le bouton reste désactivé.
 */
export function networkAvailability(env: Env, demo: boolean): Record<string, Availability> {
  const base: string[] = [];
  if (!env.SUPABASE_SERVICE_ROLE_KEY) base.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!validKey(env.TOKEN_ENCRYPTION_KEY)) base.push('TOKEN_ENCRYPTION_KEY');
  return Object.fromEntries(
    APP_NETWORKS.map((n) => {
      const family = familyForNetwork(n.id);
      const missing = demo ? [] : [...base, ...(family ? missingEnv(family, env) : [])];
      return [n.id, { available: !demo && !!family && missing.length === 0, missing }];
    })
  );
}
