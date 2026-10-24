import { MetricsUnavailableError, MissingScopeError, ReconnectRequiredError } from '../errors.ts';
import type { MetricPoint, MetricsResult } from '../types.ts';

// Aides communes aux relevés de statistiques. Les jours sont des jours UTC « 2026-10-24 ».

const DAY_MS = 86_400_000;

export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const dayOf = (time: number | string | Date): string => new Date(time).toISOString().slice(0, 10);
/** Secondes Unix du début d'un jour UTC (les paramètres `since` / `until` de l'API Graph). */
export const unix = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
/** Tous les jours de `from` à `to` inclus. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Fenêtre à lire : tout l'historique que le réseau donne au premier passage, les derniers jours ensuite (les relevés récents se corrigent). */
export function windowFor(today: string, backfill: boolean, backfillDays: number, refreshDays = 7): { since: string; until: string } {
  return { since: addDays(today, -((backfill ? backfillDays : refreshDays) - 1)), until: today };
}

/** Un nombre lisible (entier ou texte), sinon null : une valeur absente n'est jamais enregistrée comme zéro. */
export function count(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function point(day: string, metric: MetricPoint['metric'], value: unknown): MetricPoint[] {
  const n = count(value);
  return n === null ? [] : [{ day, metric, value: n }];
}

/**
 * Jour d'une valeur « par jour » de l'API Graph : `end_time` est la FIN de la période (« 2026-10-24T07:00:00+0000 » désigne la veille), donc on
 * recule d'un jour. (La limite exacte dépend du fuseau de la Page ; au jour près, c'est le jour que Meta décrit.)
 */
export function metaDay(endTime: string): string | null {
  const t = Date.parse(String(endTime).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? null : dayOf(t - DAY_MS);
}

/** Additionne une valeur qui peut être ventilée (`{ paid: 3, organic: 9 }` chez Meta). */
export function sumValue(v: unknown): number | null {
  if (v && typeof v === 'object') {
    const parts = Object.values(v as Record<string, unknown>).map(count);
    return parts.every((p) => p === null) ? null : parts.reduce<number>((a, b) => a + (b ?? 0), 0);
  }
  return count(v);
}

/** Exécute un lot de promesses `n` à la fois (les appels jour par jour d'Instagram ménagent le quota). */
export async function inBatches<T, R>(items: readonly T[], n: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(run))));
  return out;
}

/**
 * Lance les groupes de relevés d'un canal ensemble et assemble ce qui a réussi.
 *  - un jeton refusé l'emporte : on le remonte ;
 *  - tout a réussi : les relevés ;
 *  - une partie a échoué : les relevés lus, plus le problème (autorisation manquante ou panne passagère) ;
 *  - tout a échoué : on lève l'erreur (autorisation manquante en priorité).
 */
export async function gather(groups: Promise<MetricPoint[]>[]): Promise<MetricsResult> {
  const settled = await Promise.allSettled(groups);
  const points = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason] : []));
  const reconnect = failures.find((f) => f instanceof ReconnectRequiredError);
  if (reconnect) throw reconnect;
  if (failures.length === 0) return { points };
  const scope = failures.find((f) => f instanceof MissingScopeError) as MissingScopeError | undefined;
  const first = failures[0];
  const message = (scope ?? first) instanceof Error ? ((scope ?? first) as Error).message : String(scope ?? first);
  if (points.length === 0) throw scope ?? (first instanceof Error ? first : new MetricsUnavailableError(message));
  return { points, problem: { kind: scope ? 'missing_scope' : 'error', message } };
}
