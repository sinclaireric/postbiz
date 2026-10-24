import { read, type Fetch } from '../http.ts';
import { GRAPH_VERSION, graphHost } from '../meta.ts';
import type { MetricPoint, MetricsInput, MetricsResult } from '../types.ts';
import { addDays, count, daysBetween, gather, inBatches, metaDay, point, unix, windowFor } from './common.ts';

/**
 * Statistiques d'un compte Instagram professionnel (connexion par Page : graph.facebook.com ; Instagram Login : graph.instagram.com, voir
 * `settings.graph_host`). Comme Postiz : portée = `reach` par jour ; interactions = `total_interactions` (j'aime, commentaires, partages,
 * enregistrements, réponses), lues jour par jour car Meta ne la donne que sous forme de total sur la période demandée ; abonnés = `followers_count`.
 * Meta limite l'historique à 30 jours. Demande `instagram_manage_insights` (`instagram_business_manage_insights` avec Instagram Login).
 * ⚠️ Non validé contre l'API réelle.
 */
export const instagramMetrics = (fetchImpl: Fetch = fetch) => async ({ accessToken, integration, backfill, today }: MetricsInput): Promise<MetricsResult> => {
  const base = `https://${graphHost(integration.settings)}/${GRAPH_VERSION}`;
  const igId = String(integration.settings.ig_user_id ?? integration.internalId);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const { since, until } = windowFor(today, backfill, 30);

  const reach = async (): Promise<MetricPoint[]> => {
    const q = new URLSearchParams({ metric: 'reach', period: 'day', since: String(unix(since)), until: String(unix(addDays(until, 1))) });
    const json = await read(fetchImpl, `${base}/${igId}/insights?${q}`, { provider: 'Instagram', headers });
    return ((json.data ?? []) as any[]).flatMap((series) =>
      ((series.values ?? []) as any[]).flatMap((v) => {
        const day = metaDay(v.end_time);
        return day ? point(day, 'reach', v.value) : [];
      })
    );
  };

  const engagement = async (): Promise<MetricPoint[]> => {
    const days = daysBetween(since, until);
    const perDay = await inBatches(days, 5, async (day): Promise<MetricPoint[]> => {
      const q = new URLSearchParams({ metric: 'total_interactions', metric_type: 'total_value', period: 'day', since: String(unix(day)), until: String(unix(addDays(day, 1))) });
      const json = await read(fetchImpl, `${base}/${igId}/insights?${q}`, { provider: 'Instagram', headers });
      const value = count(json.data?.[0]?.total_value?.value);
      return value === null ? [] : point(day, 'engagement', value);
    });
    return perDay.flat();
  };

  const followers = async (): Promise<MetricPoint[]> => {
    const json = await read(fetchImpl, `${base}/${igId}?${new URLSearchParams({ fields: 'followers_count' })}`, { provider: 'Instagram', headers });
    return point(today, 'followers', json.followers_count);
  };

  return gather([reach(), engagement(), followers()]);
};
