import type { Env } from '@postbiz/core';
import { OutcomeUnknownError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import { oauthRefresher } from './oauth.ts';
import type { SocialProvider } from './types.ts';

/** Version de l'API LinkedIn (AAAAMM). LinkedIn retire les versions anciennes : à mettre à jour régulièrement. */
export const DEFAULT_LINKEDIN_API_VERSION = '202601';

/**
 * Une variable présente mais vide (ligne `LINKEDIN_API_VERSION=` laissée telle quelle dans le fichier d'environnement) vaut « non définie » :
 * sinon l'en-tête partirait vide et LinkedIn refuserait la publication. Une valeur qui n'est pas AAAAMM est ignorée de même.
 */
export function linkedInApiVersion(env: Env = process.env): string {
  const value = (env.LINKEDIN_API_VERSION ?? '').trim();
  return /^\d{6}$/.test(value) ? value : DEFAULT_LINKEDIN_API_VERSION;
}

/**
 * LinkedIn interprète certains caractères du texte (format « little text ») : sans échappement,
 * la publication est tronquée au premier caractère spécial.
 */
export function escapeLinkedInText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

// ⚠️ Non validé contre l'API réelle. `settings.author_urn` : `urn:li:person:<id>` (profil) ou `urn:li:organization:<id>` (Page).
export const createLinkedInProvider = (fetchImpl: Fetch = fetch, env: Env = process.env): SocialProvider => ({
  id: 'linkedin',
  supportsThreads: false,
  supportsMedia: false,
  refreshToken: oauthRefresher('linkedin', fetchImpl, env),
  async publish({ accessToken, integration, posts }) {
    const post = posts[0]!;
    const author = (integration.settings.author_urn as string | undefined) ?? `urn:li:person:${integration.internalId}`;
    const res = await mutate(
      fetchImpl,
      'https://api.linkedin.com/rest/posts',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': linkedInApiVersion(env),
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author,
          commentary: escapeLinkedInText(post.content),
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      },
      { provider: 'LinkedIn' }
    );
    const urn = res.headers.get('x-restli-id');
    if (!urn) throw new OutcomeUnknownError('LinkedIn n’a pas renvoyé d’identifiant de publication. Vérifiez sur le profil avant de republier.');
    return [{ releaseId: urn, releaseUrl: `https://www.linkedin.com/feed/update/${urn}` }];
  },
  // Commentaire sous la publication (API « Social Actions »), au nom du même auteur que la publication.
  async comment({ accessToken, integration, releaseId, text }) {
    const actor = (integration.settings.author_urn as string | undefined) ?? `urn:li:person:${integration.internalId}`;
    const res = await mutate(
      fetchImpl,
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(releaseId)}/comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': linkedInApiVersion(env),
          'X-Restli-Protocol-Version': '2.0.0',
        },
        // Le texte d'un commentaire est du texte simple : pas l'échappement « little text » des publications.
        body: JSON.stringify({ actor, object: releaseId, message: { text } }),
      },
      { provider: 'LinkedIn', subject: 'comment' }
    );
    const id = (res.json?.commentUrn ?? res.json?.id ?? res.headers.get('x-restli-id')) as string | null | undefined;
    if (!id) throw new OutcomeUnknownError('LinkedIn n’a pas renvoyé d’identifiant de commentaire. Vérifiez sous la publication avant de recommenter.');
    return { commentId: String(id) };
  },
});
