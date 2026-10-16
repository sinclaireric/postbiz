import type { Env } from '@postbiz/core';
import { PublishRejectedError } from './errors.ts';
import type { Fetch } from './http.ts';
import { oauthRefresher } from './oauth.ts';
import type { SocialProvider } from './types.ts';

// Connexion et rafraîchissement des jetons TikTok : en place. Publication : pas encore (exige l'envoi de vidéos,
// `apps/uploader` n'est pas encore branché). Le canal reste donc connecté et son jeton valide.
export const createTikTokProvider = (fetchImpl: Fetch = fetch, env: Env = process.env): SocialProvider => ({
  id: 'tiktok',
  supportsThreads: false,
  supportsMedia: false,
  refreshToken: oauthRefresher('tiktok', fetchImpl, env),
  async publish() {
    throw new PublishRejectedError('La publication sur TikTok n’est pas encore disponible (l’envoi de vidéos n’est pas branché).');
  },
});
