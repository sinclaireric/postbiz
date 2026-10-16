import { OAUTH_FAMILIES, missingEnv, TokenRejectedError, TokenTransientError, type Env, type FamilyId } from '@postbiz/core';
import { ReconnectRequiredError, RefreshTransientError } from './errors.ts';
import type { RefreshedTokens, RefreshInput } from './types.ts';

/**
 * Rafraîchissement générique : s'appuie sur la définition OAuth du réseau (packages/core/src/oauth), la même que celle
 * utilisée pour la connexion, et traduit ses erreurs dans le vocabulaire du worker.
 *  - refus du réseau (invalid_grant...) → ReconnectRequiredError : inutile de réessayer
 *  - panne passagère ou configuration manquante → RefreshTransientError : on réessaiera
 */
export function oauthRefresher(familyId: FamilyId, fetchImpl: typeof fetch, env: Env, now: () => Date = () => new Date()) {
  return async ({ refreshToken }: RefreshInput): Promise<RefreshedTokens> => {
    const family = OAUTH_FAMILIES[familyId];
    const missing = missingEnv(family, env);
    // Une variable absente est un problème du serveur, pas du compte de l'utilisateur : ne pas le déconnecter pour ça.
    if (missing.length > 0) throw new RefreshTransientError(`Configuration manquante sur le worker : ${missing.join(', ')}`);
    try {
      const t = await family.refresh!({ env, fetch: fetchImpl, now }, refreshToken);
      return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
    } catch (e) {
      if (e instanceof TokenRejectedError) throw new ReconnectRequiredError(`L’accès a été refusé par le réseau (${e.message}) : reconnectez le canal.`);
      if (e instanceof TokenTransientError) throw new RefreshTransientError(e.message);
      throw new RefreshTransientError(`Erreur inattendue : ${(e as Error).message}`);
    }
  };
}
