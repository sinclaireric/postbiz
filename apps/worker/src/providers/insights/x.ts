import { read, type Fetch } from '../http.ts';
import type { MetricsInput, MetricsResult } from '../types.ts';
import { point } from './common.ts';

/**
 * Abonnés d'un compte X (`users/me`, `public_metrics.followers_count`), relevé du jour. Les impressions et interactions de X ne sont données
 * que par publication (et selon l'offre d'accès payante), pas par jour : elles ne sont pas relevées. ⚠️ Non validé contre l'API réelle.
 */
export const xMetrics = (fetchImpl: Fetch = fetch) => async ({ accessToken, today }: MetricsInput): Promise<MetricsResult> => {
  const json = await read(fetchImpl, `https://api.x.com/2/users/me?${new URLSearchParams({ 'user.fields': 'public_metrics' })}`, { provider: 'X', headers: { Authorization: `Bearer ${accessToken}` } });
  return { points: point(today, 'followers', json?.data?.public_metrics?.followers_count) };
};
