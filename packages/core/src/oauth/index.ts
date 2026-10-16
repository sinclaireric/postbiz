import { googleFamily } from './google.ts';
import { linkedinFamily } from './linkedin.ts';
import { metaFamily } from './meta.ts';
import { tiktokFamily } from './tiktok.ts';
import type { Env, FamilyId, NetworkId, OAuthFamily } from './types.ts';
import { xFamily } from './x.ts';

export * from './types.ts';
export { codeChallenge, newCodeVerifier, randomToken, sha256Hex } from './pkce.ts';
export { checkState, createState } from './state.ts';
export { META_SUBSCRIBED_FIELDS } from './meta.ts';

export const OAUTH_FAMILIES: Record<FamilyId, OAuthFamily> = {
  meta: metaFamily,
  x: xFamily,
  linkedin: linkedinFamily,
  google: googleFamily,
  tiktok: tiktokFamily,
};

export const isFamilyId = (v: string): v is FamilyId => Object.hasOwn(OAUTH_FAMILIES, v);

export function familyForNetwork(network: string): OAuthFamily | null {
  return Object.values(OAUTH_FAMILIES).find((f) => (f.networks as readonly string[]).includes(network)) ?? null;
}

export const NETWORK_IDS: readonly NetworkId[] = ['facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'youtube'];

/** Variables d'environnement manquantes pour activer la connexion de cette famille (liste vide = prête). */
export function missingEnv(family: OAuthFamily, env: Env): string[] {
  return family.envKeys.filter((k) => !env[k]);
}
