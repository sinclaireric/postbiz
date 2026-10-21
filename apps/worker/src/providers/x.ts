import type { Env } from '@postbiz/core';
import { OutcomeUnknownError } from './errors.ts';
import { mutate, type Fetch } from './http.ts';
import { oauthRefresher } from './oauth.ts';
import type { SocialProvider } from './types.ts';

// ⚠️ Non validé contre l'API réelle. Nécessite un jeton OAuth 2.0 « user context » avec le scope tweet.write
// et un accès API payant à publier (voir docs/RESEAUX.md).
export const createXProvider = (fetchImpl: Fetch = fetch, env: Env = process.env): SocialProvider => ({
  id: 'x',
  supportsThreads: false,
  supportsMedia: false,
  refreshToken: oauthRefresher('x', fetchImpl, env),
  async publish({ accessToken, posts }) {
    const post = posts[0]!;
    const res = await mutate(
      fetchImpl,
      'https://api.x.com/2/tweets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ text: post.content }),
      },
      { provider: 'X' }
    );
    const id = res.json?.data?.id as string | undefined;
    if (!id) throw new OutcomeUnknownError('X n’a pas renvoyé d’identifiant de publication. Vérifiez sur le compte avant de republier.');
    return [{ releaseId: id, releaseUrl: `https://x.com/i/web/status/${id}` }];
  },
  // Sur X, le « premier commentaire » est une réponse à sa propre publication.
  async comment({ accessToken, releaseId, text }) {
    const res = await mutate(
      fetchImpl,
      'https://api.x.com/2/tweets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: releaseId } }),
      },
      { provider: 'X', subject: 'comment' }
    );
    const id = res.json?.data?.id as string | undefined;
    if (!id) throw new OutcomeUnknownError('X n’a pas renvoyé d’identifiant de réponse. Vérifiez sous la publication avant de recommenter.');
    return { commentId: id };
  },
});
