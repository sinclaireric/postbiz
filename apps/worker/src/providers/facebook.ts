import { OutcomeUnknownError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import type { SocialProvider } from './types.ts';

const VERSION = 'v23.0';

// ⚠️ Non validé contre l'API réelle : à tester avec une Page de test avant la revue Meta.
export const createFacebookProvider = (fetchImpl: Fetch = fetch): SocialProvider => ({
  id: 'facebook',
  supportsThreads: false,
  supportsMedia: false,
  async publish({ accessToken, integration, posts }) {
    const post = posts[0]!;
    const res = await mutate(
      fetchImpl,
      `https://graph.facebook.com/${VERSION}/${integration.internalId}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ message: post.content }),
      },
      { provider: 'Facebook' }
    );
    const id = res.json?.id as string | undefined;
    if (!id) throw new OutcomeUnknownError('Facebook n’a pas renvoyé d’identifiant de publication. Vérifiez sur la Page avant de republier.');
    return [{ releaseId: id, releaseUrl: `https://www.facebook.com/${id}` }];
  },
});
