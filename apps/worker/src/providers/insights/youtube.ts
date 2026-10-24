import { read, type Fetch } from '../http.ts';
import type { MetricPoint, MetricsInput, MetricsResult } from '../types.ts';
import { count, gather, point, windowFor } from './common.ts';

/**
 * Statistiques d'une chaîne YouTube, comme Postiz (API YouTube Analytics, `reports.query` par jour) : portée = vues ; interactions = mentions
 * J'aime + commentaires + partages ; abonnés = `subscriberCount` de la chaîne (relevé du jour). YouTube publie les chiffres avec un ou deux jours
 * de retard : les derniers jours se corrigent aux passages suivants. Demande `yt-analytics.readonly`. ⚠️ Non validé contre l'API réelle.
 */
export const youtubeMetrics = (fetchImpl: Fetch = fetch) => async ({ accessToken, backfill, today }: MetricsInput): Promise<MetricsResult> => {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const { since, until } = windowFor(today, backfill, 90);

  const daily = async (): Promise<MetricPoint[]> => {
    const q = new URLSearchParams({ ids: 'channel==MINE', startDate: since, endDate: until, metrics: 'views,likes,comments,shares', dimensions: 'day', sort: 'day' });
    const json = await read(fetchImpl, `https://youtubeanalytics.googleapis.com/v2/reports?${q}`, { provider: 'YouTube', headers });
    const names = ((json.columnHeaders ?? []) as any[]).map((c) => c?.name);
    const col = (row: any[], name: string) => row[names.indexOf(name)];
    return ((json.rows ?? []) as any[][]).flatMap((row) => {
      const day = col(row, 'day');
      if (typeof day !== 'string') return [];
      const interactions = ['likes', 'comments', 'shares'].map((n) => count(col(row, n)));
      return [
        ...point(day, 'reach', col(row, 'views')),
        ...(interactions.some((n) => n !== null) ? point(day, 'engagement', interactions.reduce<number>((a, n) => a + (n ?? 0), 0)) : []),
      ];
    });
  };

  const followers = async (): Promise<MetricPoint[]> => {
    const json = await read(fetchImpl, `https://www.googleapis.com/youtube/v3/channels?${new URLSearchParams({ part: 'statistics', mine: 'true' })}`, { provider: 'YouTube', headers });
    const stats = json.items?.[0]?.statistics;
    return stats?.hiddenSubscriberCount ? [] : point(today, 'followers', stats?.subscriberCount); // abonnés masqués par la chaîne : rien à relever
  };

  return gather([daily(), followers()]);
};
