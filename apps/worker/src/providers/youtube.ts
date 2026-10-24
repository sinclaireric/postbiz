import type { Env } from '@postbiz/core';
import { PublishRejectedError } from './errors.ts';
import type { Fetch } from './http.ts';
import { youtubeMetrics } from './insights/youtube.ts';
import { oauthRefresher } from './oauth.ts';
import type { SocialProvider } from './types.ts';

// Connexion et rafraîchissement des jetons YouTube : en place. Publication : pas encore (exige l'envoi de vidéos,
// `apps/uploader` n'est pas encore branché). Le canal reste donc connecté et son jeton valide.
export const createYouTubeProvider = (fetchImpl: Fetch = fetch, env: Env = process.env): SocialProvider => ({
  id: 'youtube',
  supportsThreads: false,
  supportsMedia: false,
  refreshToken: oauthRefresher('google', fetchImpl, env),
  metrics: youtubeMetrics(fetchImpl),
  async publish() {
    throw new PublishRejectedError('La publication sur YouTube n’est pas encore disponible (l’envoi de vidéos n’est pas branché).');
  },
});
