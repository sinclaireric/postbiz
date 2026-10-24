import { read, type Fetch } from '../http.ts';
import { GRAPH_VERSION } from '../meta.ts';
import type { MetricPoint, MetricsInput, MetricsResult } from '../types.ts';
import { addDays, gather, metaDay, point, sumValue, unix, windowFor } from './common.ts';

/**
 * Statistiques d'une Page Facebook (comme Postiz) : portée = `page_total_media_view_unique`, interactions = `page_post_engagements`, par jour sur
 * 90 jours au premier passage ; abonnés = `followers_count` de la Page, relevé du jour (Meta ne donne pas l'historique du total).
 * Demande l'autorisation `read_insights`. ⚠️ Non validé contre l'API réelle (voir docs/RESEAUX.md).
 */
export const facebookMetrics = (fetchImpl: Fetch = fetch) => async ({ accessToken, integration, backfill, today }: MetricsInput): Promise<MetricsResult> => {
  const page = integration.internalId;
  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const { since, until } = windowFor(today, backfill, 90);

  const daily = async (): Promise<MetricPoint[]> => {
    const q = new URLSearchParams({ metric: 'page_total_media_view_unique,page_post_engagements', period: 'day', since: String(unix(since)), until: String(unix(addDays(until, 1))) });
    const json = await read(fetchImpl, `${base}/${page}/insights?${q}`, { provider: 'Facebook', headers });
    return ((json.data ?? []) as any[]).flatMap((series) => {
      const metric = series.name === 'page_total_media_view_unique' ? 'reach' : series.name === 'page_post_engagements' ? 'engagement' : null;
      if (!metric) return [];
      return ((series.values ?? []) as any[]).flatMap((v) => {
        const day = metaDay(v.end_time);
        return day ? point(day, metric, sumValue(v.value)) : [];
      });
    });
  };

  const followers = async (): Promise<MetricPoint[]> => {
    const json = await read(fetchImpl, `${base}/${page}?${new URLSearchParams({ fields: 'followers_count,fan_count' })}`, { provider: 'Facebook', headers });
    return point(today, 'followers', json.followers_count ?? json.fan_count);
  };

  return gather([daily(), followers()]);
};
