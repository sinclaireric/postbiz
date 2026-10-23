import type { Env } from '@postbiz/core';
import { PublishRejectedError } from './errors.ts';
import type { Fetch } from './http.ts';
import { oauthRefresher } from './oauth.ts';
import type { SocialProvider } from './types.ts';

// Instagram : la publication n'est pas encore disponible (elle exige l'envoi d'une image ou d'une vidéo, `apps/uploader` n'est pas branché).
// En revanche les canaux connectés par « Instagram Login » (sans Page) ont un jeton de 60 jours à prolonger : seuls ceux-là ont un refresh token
// (voir packages/core/src/oauth/instagram.ts) ; les comptes liés à une Page ont un jeton de Page sans expiration et ne sont jamais réclamés.
export const createInstagramProvider = (fetchImpl: Fetch = fetch, env: Env = process.env): SocialProvider => ({
  id: 'instagram',
  supportsThreads: false,
  supportsMedia: false,
  refreshToken: oauthRefresher('instagram_login', fetchImpl, env),
  async publish() {
    throw new PublishRejectedError('La publication sur Instagram n’est pas encore disponible (l’envoi d’images et de vidéos n’est pas branché).');
  },
});
