import { DEFAULT_LINKEDIN_API_VERSION, linkedInApiVersion, type Env } from '@postbiz/core';
import { OutcomeUnknownError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import { oauthRefresher } from './oauth.ts';
import type { SocialProvider } from './types.ts';

// La version de l'API (en-tête LinkedIn-Version) est partagée avec la connexion des canaux : voir @postbiz/core.
export { DEFAULT_LINKEDIN_API_VERSION, linkedInApiVersion };

/**
 * LinkedIn interprète certains caractères du texte (format « little text ») : sans échappement,
 * la publication est tronquée au premier caractère spécial.
 */
export function escapeLinkedInText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

// Sert le profil (« linkedin ») et les Pages (« linkedin_page ») : seul `settings.author_urn` change.
// ⚠️ Non validé contre l'API réelle. `settings.author_urn` : `urn:li:person:<id>` (profil) ou `urn:li:organization:<id>` (Page).
export const createLinkedInProvider = (fetchImpl: Fetch = fetch, env: Env = process.env, family: 'linkedin' | 'linkedin_page' = 'linkedin'): SocialProvider => ({
  id: 'linkedin',
  supportsThreads: false,
  supportsMedia: false,
  // Les Pages ont leur propre application LinkedIn : on rafraîchit avec ses clés.
  refreshToken: oauthRefresher(family, fetchImpl, env),
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
