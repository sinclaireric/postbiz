// Collecte des statistiques d'audience des canaux (abonnés, portée, interactions) : comme Postiz, on interroge chaque réseau avec le jeton du canal,
// mais ici les chiffres sont enregistrés (table channel_metrics_daily) au lieu d'être lus en direct à chaque affichage de la page.
//
// Règles :
//  - un canal est collecté au plus une fois toutes les 6 heures (le jour en cours se corrige d'un passage à l'autre) ; le premier passage remonte
//    tout l'historique que le réseau donne (jusqu'à 90 jours), les suivants relisent les derniers jours ;
//  - un seul worker collecte un canal à la fois (verrou posé par claim_metrics_sync) ;
//  - jeton refusé → canal « refresh_needed » (comme à la publication) ; autorisation manquante → statut « missing_scope » (la page demande de reconnecter,
//    on revérifie toutes les 3 heures) ; panne passagère → délai croissant, 15 minutes à 12 heures ;
//  - une collecte partielle garde ce qui a été lu et signale le problème (ex. abonnés lus, statistiques refusées).
import type { SupabaseClient } from '@supabase/supabase-js';
import { MissingScopeError, ReconnectRequiredError } from '../providers/errors.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { MetricPoint } from '../providers/types.ts';

export interface MetricsJob {
  id: string;
  orgId: string;
  provider: string;
  name: string;
  internalId: string;
  settings: Record<string, unknown>;
  /** Échecs consécutifs avant ce passage (0 si le dernier s'est bien passé). */
  attempts: number;
  /** Le premier passage (historique complet) a déjà eu lieu. */
  backfilled: boolean;
}

export interface MetricsDb {
  claim(providers: string[], o: { limit: number; lockSeconds: number }): Promise<MetricsJob[]>;
  getAccessToken(integrationId: string): Promise<string | null>;
  record(integrationId: string, points: MetricPoint[]): Promise<number>;
  complete(integrationId: string, o: { nextSeconds: number; backfilled: boolean }): Promise<void>;
  fail(integrationId: string, o: { status: 'missing_scope' | 'error'; error: string; nextSeconds: number }): Promise<void>;
  markRefreshNeeded(integrationId: string): Promise<void>;
}

export interface MetricsStats {
  collected: number;
  /** Collectes qui n'ont réussi qu'en partie. */
  partial: number;
  missingScope: number;
  reconnectNeeded: number;
  errors: number;
  points: number;
}

/** Réseaux dont on sait relever des statistiques (ceux dont le fournisseur a `metrics` sont réclamés). */
export const METRICS_PROVIDERS = ['facebook', 'instagram', 'linkedin_page', 'youtube', 'tiktok', 'x'] as const;

const HOUR = 3600;
export const COLLECT_EVERY_SECONDS = 6 * HOUR;
export const MISSING_SCOPE_RETRY_SECONDS = 3 * HOUR;
export const RECONNECT_RETRY_SECONDS = 24 * HOUR;
const LOCK_SECONDS = 10 * 60;
/** Délai avant de réessayer après une panne passagère : 15 min, 30 min, 1 h… plafonné à 12 h. */
export const retryDelaySeconds = (attempts: number): number => Math.min(12 * HOUR, 900 * 2 ** Math.min(Math.max(attempts, 0), 6));

/** Un relevé par (jour, métrique) : le dernier gagne. */
const dedupe = (points: MetricPoint[]): MetricPoint[] => [...new Map(points.map((p) => [`${p.day}|${p.metric}`, p])).values()];

export async function collectMetrics(
  deps: { db: MetricsDb; providers: ProviderRegistry },
  o: { limit?: number; now?: () => Date } = {},
  log: (msg: string, extra?: unknown) => void = () => {}
): Promise<MetricsStats> {
  const { db, providers } = deps;
  const stats: MetricsStats = { collected: 0, partial: 0, missingScope: 0, reconnectNeeded: 0, errors: 0, points: 0 };

  const capable = METRICS_PROVIDERS.filter((id) => providers(id)?.metrics);
  if (capable.length === 0) return stats;
  const jobs = await db.claim(capable, { limit: o.limit ?? 10, lockSeconds: LOCK_SECONDS });
  const today = (o.now ?? (() => new Date()))().toISOString().slice(0, 10);

  // Un canal à la fois : les réseaux limitent le nombre de requêtes par application, et rien ne presse (une collecte toutes les 6 heures).
  for (const job of jobs) {
    const where = `${job.provider} ${job.id}`;
    try {
      const provider = providers(job.provider);
      if (!provider?.metrics) {
        await db.complete(job.id, { nextSeconds: RECONNECT_RETRY_SECONDS, backfilled: job.backfilled });
        continue;
      }
      const token = await db.getAccessToken(job.id);
      if (!token) {
        stats.errors++;
        await db.fail(job.id, { status: 'error', error: 'Le jeton du canal est absent ou illisible.', nextSeconds: retryDelaySeconds(job.attempts) });
        continue;
      }
      const result = await provider.metrics({
        accessToken: token,
        integration: { id: job.id, internalId: job.internalId, settings: job.settings },
        backfill: !job.backfilled,
        today,
      });
      const points = dedupe(result.points);
      if (points.length > 0) stats.points += await db.record(job.id, points);
      if (result.problem) {
        // Ce qui a été lu est gardé ; le passage initial (historique) n'est pas marqué fait, il sera retenté.
        stats.partial++;
        if (result.problem.kind === 'missing_scope') stats.missingScope++;
        else stats.errors++;
        await db.fail(job.id, {
          status: result.problem.kind,
          error: result.problem.message,
          nextSeconds: result.problem.kind === 'missing_scope' ? MISSING_SCOPE_RETRY_SECONDS : retryDelaySeconds(job.attempts),
        });
        log(`statistiques partielles : ${where}`, result.problem.message);
      } else {
        stats.collected++;
        await db.complete(job.id, { nextSeconds: COLLECT_EVERY_SECONDS, backfilled: true });
        log(`statistiques relevées : ${where} (${points.length} relevés)`);
      }
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      try {
        if (e instanceof ReconnectRequiredError) {
          stats.reconnectNeeded++;
          log(`statistiques : accès refusé, canal à reconnecter : ${where}`);
          await db.markRefreshNeeded(job.id);
          await db.fail(job.id, { status: 'error', error: message, nextSeconds: RECONNECT_RETRY_SECONDS });
        } else if (e instanceof MissingScopeError) {
          stats.missingScope++;
          log(`statistiques : autorisation manquante : ${where}`, message);
          await db.fail(job.id, { status: 'missing_scope', error: message, nextSeconds: MISSING_SCOPE_RETRY_SECONDS });
        } else {
          stats.errors++;
          log(`statistiques différées : ${where}`, message);
          await db.fail(job.id, { status: 'error', error: message, nextSeconds: retryDelaySeconds(job.attempts) });
        }
      } catch (inner) {
        // Si même l'enregistrement de l'échec échoue, le verrou (10 min) expire et le canal sera repris.
        log(`enregistrement de l'échec impossible : ${where}`, (inner as Error).message);
      }
    }
  }
  return stats;
}

type Row = Record<string, any>;

export function createSupabaseMetricsDb(supabase: SupabaseClient, decrypt: (enc: string) => Promise<string>): MetricsDb {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what} : ${error.message}`);
  };
  return {
    async claim(providers, o) {
      const { data, error } = await supabase.rpc('claim_metrics_sync', { p_providers: providers, p_limit: o.limit, p_lock_seconds: o.lockSeconds });
      check(error, 'claim_metrics_sync');
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id, orgId: r.org_id, provider: r.provider, name: r.name, internalId: r.internal_id, settings: r.settings ?? {},
        attempts: Number(r.attempts ?? 0), backfilled: r.backfilled === true,
      }));
    },
    async getAccessToken(integrationId) {
      const { data, error } = await supabase.from('integration_secrets').select('access_token_enc').eq('integration_id', integrationId).maybeSingle();
      check(error, 'lecture du jeton');
      return data?.access_token_enc ? decrypt(data.access_token_enc).catch(() => null) : null;
    },
    async record(integrationId, points) {
      const { data, error } = await supabase.rpc('record_channel_metrics', { p_integration: integrationId, p_rows: points });
      check(error, 'enregistrement des relevés');
      return Number(data ?? 0);
    },
    async complete(integrationId, o) {
      const { error } = await supabase.rpc('complete_metrics_sync', { p_integration: integrationId, p_next_seconds: o.nextSeconds, p_backfilled: o.backfilled });
      check(error, 'complete_metrics_sync');
    },
    async fail(integrationId, o) {
      const { error } = await supabase.rpc('fail_metrics_sync', { p_integration: integrationId, p_status: o.status, p_error: o.error.slice(0, 300), p_next_seconds: o.nextSeconds });
      check(error, 'fail_metrics_sync');
    },
    async markRefreshNeeded(integrationId) {
      const { error } = await supabase.from('integrations').update({ status: 'refresh_needed' }).eq('id', integrationId);
      check(error, 'mise à jour du canal');
    },
  };
}
