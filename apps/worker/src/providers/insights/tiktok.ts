import { MetricsUnavailableError, MissingScopeError, ReconnectRequiredError } from '../errors.ts';
import { classifyReadFailure, read, type Fetch } from '../http.ts';
import type { MetricsInput, MetricsResult } from '../types.ts';
import { point } from './common.ts';

/**
 * Abonnés d'un compte TikTok (`user/info`, champ `follower_count`), relevé du jour. TikTok ne donne ni historique ni portée par jour : seuls les
 * totaux cumulés des vidéos existent, qui ne sont pas des quantités du jour. Demande `user.info.stats`. ⚠️ Non validé contre l'API réelle.
 */
export const tiktokMetrics = (fetchImpl: Fetch = fetch) => async ({ accessToken, today }: MetricsInput): Promise<MetricsResult> => {
  const json = await read(fetchImpl, `https://open.tiktokapis.com/v2/user/info/?${new URLSearchParams({ fields: 'follower_count' })}`, { provider: 'TikTok', headers: { Authorization: `Bearer ${accessToken}` } });
  // TikTok répond parfois 200 avec une erreur dans le corps (`error.code` différent de « ok »).
  const code = json?.error?.code;
  if (code && code !== 'ok') {
    const kind = classifyReadFailure(400, json);
    if (kind === 'scope') throw new MissingScopeError(`TikTok refuse l’accès aux statistiques (${String(json.error.message ?? code).slice(0, 150)}). Reconnectez le canal pour accorder l’autorisation.`);
    if (kind === 'reconnect') throw new ReconnectRequiredError();
    throw new MetricsUnavailableError(`TikTok a refusé la lecture (${String(code).slice(0, 80)}).`);
  }
  return { points: point(today, 'followers', json?.data?.user?.follower_count) };
};
