import { googleFamily } from './google.ts';
import { instagramLoginFamily } from './instagram.ts';
import { linkedinFamily, linkedinPageFamily } from './linkedin.ts';
import { metaFamily } from './meta.ts';
import { tiktokFamily } from './tiktok.ts';
import type { Env, FamilyId, NetworkId, OAuthFamily } from './types.ts';
import { xFamily } from './x.ts';

export * from './types.ts';
export { codeChallenge, newCodeVerifier, randomToken, sha256Hex } from './pkce.ts';
export { checkState, createState } from './state.ts';
export { META_SUBSCRIBED_FIELDS } from './meta.ts';
export { DEFAULT_LINKEDIN_API_VERSION, linkedInApiVersion } from './linkedin.ts';

export const OAUTH_FAMILIES: Record<FamilyId, OAuthFamily> = {
  meta: metaFamily,
  instagram_login: instagramLoginFamily,
  x: xFamily,
  linkedin: linkedinFamily,
  linkedin_page: linkedinPageFamily,
  google: googleFamily,
  tiktok: tiktokFamily,
};

export const isFamilyId = (v: string): v is FamilyId => Object.hasOwn(OAUTH_FAMILIES, v);

export function familyForNetwork(network: string): OAuthFamily | null {
  return Object.values(OAUTH_FAMILIES).find((f) => (f.networks as readonly string[]).includes(network)) ?? null;
}

export const NETWORK_IDS: readonly NetworkId[] = ['facebook', 'instagram', 'instagram_standalone', 'x', 'linkedin', 'linkedin_page', 'tiktok', 'youtube'];

/**
 * Famille qui gère un canal déjà connecté. Un compte Instagram connecté par « Instagram Login » est enregistré comme un canal `instagram`
 * (comme celui d'une Page) : seul `settings.login` dit lequel des deux, donc comment révoquer, se désabonner ou prolonger son jeton.
 */
export function familyForChannel(network: string, settings: Record<string, unknown> | null | undefined): OAuthFamily | null {
  if (network === 'instagram' && settings?.login === 'instagram') return OAUTH_FAMILIES.instagram_login;
  return familyForNetwork(network);
}

/** Variables d'environnement manquantes pour activer la connexion de cette famille (liste vide = prête). */
export function missingEnv(family: OAuthFamily, env: Env): string[] {
  return family.envKeys.filter((k) => !env[k]);
}
