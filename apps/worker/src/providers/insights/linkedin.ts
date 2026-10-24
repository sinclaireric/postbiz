import { linkedInApiVersion, type Env } from '@postbiz/core';
import { read, type Fetch } from '../http.ts';
import type { MetricPoint, MetricsInput, MetricsResult } from '../types.ts';
import { addDays, count, dayOf, gather, point, windowFor } from './common.ts';

/**
 * Statistiques d'une Page LinkedIn (organisation), comme Postiz : par jour, `organizationalEntityShareStatistics` (portée = impressions ;
 * interactions = j'aime + commentaires + partages) ; abonnés = taille du réseau « abonnés de la Page » (`networkSizes`), relevé du jour.
 * Seules les Pages ont ces statistiques : un profil personnel n'en a pas par l'API. Demande `r_organization_social` (ou `rw_organization_admin`).
 * ⚠️ Non validé contre l'API réelle.
 */
export const linkedInPageMetrics = (fetchImpl: Fetch = fetch, env: Env = process.env) => async ({ accessToken, integration, backfill, today }: MetricsInput): Promise<MetricsResult> => {
  const urn = String(integration.settings.author_urn ?? `urn:li:organization:${integration.internalId}`);
  const headers = { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': linkedInApiVersion(env), 'X-Restli-Protocol-Version': '2.0.0' };
  const { since, until } = windowFor(today, backfill, 90);
  const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);

  const daily = async (): Promise<MetricPoint[]> => {
    // La syntaxe Rest.li des intervalles s'écrit telle quelle dans l'adresse (parenthèses, deux-points, virgules) ; seul l'URN est encodé.
    const url =
      'https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity' +
      `&organizationalEntity=${encodeURIComponent(urn)}` +
      `&timeIntervals=(timeRange:(start:${ms(since)},end:${ms(addDays(until, 1))}),timeGranularityType:DAY)`;
    const json = await read(fetchImpl, url, { provider: 'LinkedIn', headers });
    return ((json.elements ?? []) as any[]).flatMap((e) => {
      const start = e?.timeRange?.start;
      const s = e?.totalShareStatistics;
      if (typeof start !== 'number' || !s) return [];
      const day = dayOf(start);
      const interactions = [s.likeCount, s.commentCount, s.shareCount].map(count);
      return [
        ...point(day, 'reach', s.impressionCount),
        ...(interactions.some((n) => n !== null) ? point(day, 'engagement', interactions.reduce<number>((a, n) => a + (n ?? 0), 0)) : []),
      ];
    });
  };

  const followers = async (): Promise<MetricPoint[]> => {
    const json = await read(fetchImpl, `https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(urn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { provider: 'LinkedIn', headers });
    return point(today, 'followers', json.firstDegreeSize);
  };

  return gather([daily(), followers()]);
};
