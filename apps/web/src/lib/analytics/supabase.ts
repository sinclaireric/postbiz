import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppContext } from '@/lib/data/types';
import { activityRows, addDays, metricRowsFromDb, queueCounts, type MessageFact, type PostFact, type QueuedFact } from './logic';
import type { AnalyticsData, AnalyticsRepository, ChannelCollection, CollectionStatus, DailyMetricRow, RecentPost } from './types';

// Lecture réelle des chiffres de la page Analyses.
//
//  - Activité (publications, messages reçus, réponses, échecs) : calculée à la volée à partir des publications et des messages de l'organisation.
//  - Audience (abonnés, portée, interactions) : lue dans `channel_metrics_daily`, que le worker alimente chaque jour auprès des réseaux
//    (apps/worker/src/engine/metrics.ts). Tant qu'un canal n'a pas été collecté, il n'a aucune ligne et la page affiche « pas encore de données »
//    au lieu de zéros ; `channel_metrics_sync` dit pourquoi (par exemple « autorisation à renouveler »).

type Row = Record<string, any>;

/** PostgREST plafonne chaque réponse (1000 lignes par défaut) : on lit page par page, avec une limite pour borner la mémoire. */
const PAGE = 1000;
const MAX_PAGES = 10;
/** Publications récentes lues pour tous les canaux : assez pour qu'un canal choisi en retrouve quelques-unes. */
const RECENT_LIMIT = 60;

type Page = PromiseLike<{ data: Row[] | null; error: unknown }>;

async function readAll(page: (from: number, to: number) => Page): Promise<{ rows: Row[]; truncated: boolean; error: boolean }> {
  const rows: Row[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, (i + 1) * PAGE - 1);
    if (error || !data) return { rows, truncated: false, error: true };
    rows.push(...data);
    if (data.length < PAGE) return { rows, truncated: false, error: false };
  }
  return { rows, truncated: true, error: false };
}

const one = (v: Row | Row[] | null | undefined): Row | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export function createSupabaseAnalytics(supabase: SupabaseClient, ctx: AppContext): AnalyticsRepository {
  return {
    async load(window, now = new Date()): Promise<AnalyticsData> {
      const start = `${window.from}T00:00:00Z`;
      const end = `${addDays(window.to, 1)}T00:00:00Z`;

      const [posts, messages, waiting, latest, stored, sync] = await Promise.all([
        // Les publications terminées de la fenêtre (sans les suites de fil : une publication = son premier message).
        readAll((a, b) =>
          supabase.from('posts').select('integration_id, state, publish_at')
            .eq('org_id', ctx.org.id).is('deleted_at', null).is('parent_post_id', null)
            .in('state', ['published', 'error', 'unknown'])
            .gte('publish_at', start).lt('publish_at', end)
            .order('publish_at').order('id').range(a, b),
        ),
        // Messages reçus et réponses réellement envoyées ; le canal est celui de la conversation.
        readAll((a, b) =>
          supabase.from('messages').select('created_at, direction, delivery_status, conversations!inner(integration_id)')
            .eq('org_id', ctx.org.id)
            .gte('created_at', start).lt('created_at', end)
            .or('direction.eq.in,and(direction.eq.out,delivery_status.eq.sent)')
            .order('created_at').order('id').range(a, b),
        ),
        // La file de publication : brouillons, et programmées dans les 7 prochains jours.
        readAll((a, b) =>
          supabase.from('posts').select('integration_id, state, publish_at')
            .eq('org_id', ctx.org.id).is('deleted_at', null).is('parent_post_id', null)
            .or(`state.eq.draft,and(state.in.(queued,publishing),publish_at.gte.${now.toISOString()},publish_at.lt.${new Date(now.getTime() + 7 * 86_400_000).toISOString()})`)
            .order('created_at').order('id').range(a, b),
        ),
        // Les dernières publications envoyées (texte et adresse sur le réseau) : une page suffit, le filtre par canal se fait ensuite.
        supabase.from('posts').select('id, integration_id, content, publish_at, release_url')
          .eq('org_id', ctx.org.id).is('deleted_at', null).is('parent_post_id', null)
          .eq('state', 'published')
          .gte('publish_at', start).lt('publish_at', end)
          .order('publish_at', { ascending: false }).limit(RECENT_LIMIT)
          .then(({ data, error }) => ({ rows: (data ?? []) as Row[], truncated: false, error: Boolean(error) })),
        // Statistiques d'audience relevées par le worker (abonnés, portée, interactions) : une ligne par canal, jour et métrique.
        readAll((a, b) =>
          supabase.from('channel_metrics_daily').select('integration_id, day, metric, value')
            .eq('org_id', ctx.org.id).gte('day', window.from).lte('day', window.to)
            .order('integration_id').order('day').order('metric').range(a, b),
        ),
        // Où en est la collecte de chaque canal : la page demande de reconnecter ceux dont le réseau refuse les statistiques.
        supabase.from('channel_metrics_sync').select('integration_id, status').eq('org_id', ctx.org.id)
          .then(({ data, error }) => ({ rows: (data ?? []) as Row[], truncated: false, error: Boolean(error) })),
      ]);

      const postFacts: PostFact[] = posts.rows.map((p) => ({ integrationId: p.integration_id, state: p.state, at: p.publish_at }));
      const messageFacts: MessageFact[] = messages.rows.flatMap((m): MessageFact[] => {
        const integrationId = one(m.conversations)?.integration_id;
        return integrationId ? [{ integrationId, direction: m.direction, deliveryStatus: m.delivery_status, at: m.created_at }] : [];
      });
      const queued: QueuedFact[] = waiting.rows.map((p) => ({ integrationId: p.integration_id, state: p.state, at: p.publish_at }));

      const recent: RecentPost[] = latest.rows.map((p) => ({ id: p.id, integrationId: p.integration_id, content: p.content ?? '', at: p.publish_at, url: p.release_url ?? null }));

      const rows: DailyMetricRow[] = [...activityRows(postFacts, messageFacts, window), ...metricRowsFromDb(stored.rows)];
      const collection: ChannelCollection[] = sync.rows.flatMap((s): ChannelCollection[] =>
        typeof s.integration_id === 'string' && ['pending', 'ok', 'missing_scope', 'error'].includes(s.status) ? [{ integrationId: s.integration_id, status: s.status as CollectionStatus }] : [],
      );
      return {
        rows,
        collection,
        queue: queueCounts(queued, now),
        recent,
        truncated: posts.truncated || messages.truncated || waiting.truncated || stored.truncated,
        // Une lecture des statistiques d'audience en échec n'empêche pas d'afficher l'activité : la page le signale par son bandeau d'alerte.
        error: posts.error || messages.error || waiting.error || latest.error || stored.error || sync.error,
      };
    },
  };
}
