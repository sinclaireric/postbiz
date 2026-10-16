import { OutcomeUnknownError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import type { SocialProvider } from './types.ts';

/** Version de l'API LinkedIn (AAAAMM). LinkedIn retire les versions anciennes : à mettre à jour régulièrement. */
export const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION ?? '202601';

/**
 * LinkedIn interprète certains caractères du texte (format « little text ») : sans échappement,
 * la publication est tronquée au premier caractère spécial.
 */
export function escapeLinkedInText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

// ⚠️ Non validé contre l'API réelle. `settings.author_urn` : `urn:li:person:<id>` (profil) ou `urn:li:organization:<id>` (Page).
export const createLinkedInProvider = (fetchImpl: Fetch = fetch): SocialProvider => ({
  id: 'linkedin',
  supportsThreads: false,
  supportsMedia: false,
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
          'LinkedIn-Version': LINKEDIN_API_VERSION,
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
});
