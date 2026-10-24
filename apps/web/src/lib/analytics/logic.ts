import {
  ACTIVITY_METRICS, CARD_METRICS, DEFAULT_PERIOD, METRIC_KIND, PERIODS, isAudienceMetric,
  type AnalyticsData, type CardMetric, type ChannelCollection, type DailyMetric, type DailyMetricRow, type Day, type Period, type QueueCount, type RecentPost,
} from './types';

// Calculs de la page Analyses : fenêtres de dates, lecture de l'adresse, agrégation par canal, variation. Rien ici ne touche à la base ni à
// l'interface, donc tout est testable. Les jours sont des jours civils en UTC (la page n'a pas de fuseau d'organisation).

const DAY_MS = 86_400_000;
const parse = (day: Day) => Date.parse(`${day}T00:00:00Z`);

export const dayKey = (d: Date): Day => d.toISOString().slice(0, 10);
export const addDays = (day: Day, n: number): Day => dayKey(new Date(parse(day) + n * DAY_MS));
/** Tous les jours de `from` à `to` inclus (liste vide si `from` est après `to`). */
export function dayRange(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------- fenêtres

export interface Windows {
  from: Day;
  to: Day;
  prevFrom: Day;
  prevTo: Day;
  /** Les jours de la période choisie, puis ceux de la période précédente (de même longueur, juste avant), puis les deux ensemble. */
  days: Day[];
  prevDays: Day[];
  all: Day[];
}

/** La période choisie finit aujourd'hui (inclus) ; la précédente a la même durée et se termine la veille de son début. */
export function periodWindows(period: Period, today: Day): Windows {
  const from = addDays(today, -(period - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(period - 1));
  return { from, to: today, prevFrom, prevTo, days: dayRange(from, today), prevDays: dayRange(prevFrom, prevTo), all: dayRange(prevFrom, today) };
}

// ---------------------------------------------------------------- adresse

/** Ce que l'adresse décide : le canal, la période et la métrique (null tant qu'on n'a pas cliqué une carte). */
export interface AnalyticsState {
  days: Period;
  metric: CardMetric | null;
  /** Identifiant du canal ; null = tous les canaux. */
  channel: string | null;
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Lit `?canal=…&periode=…&metrique=…` ; toute valeur inconnue retombe sur le défaut (jamais d'erreur à cause de l'adresse). */
export function parseAnalyticsParams(raw: RawParams, channelIds: readonly string[]): AnalyticsState {
  const wanted = Number(first(raw.periode));
  const days = PERIODS.find((p) => p === wanted) ?? DEFAULT_PERIOD;
  const m = first(raw.metrique);
  const metric = CARD_METRICS.find((x) => x === m) ?? null;
  const c = first(raw.canal);
  const channel = c && channelIds.includes(c) ? c : null;
  return { days, metric, channel };
}

export const ANALYTICS_PATH = '/app/analyses';

/** Adresse partageable d'un état ; les valeurs par défaut sont omises pour garder des adresses courtes. */
export function analyticsHref(state: AnalyticsState): string {
  const q = new URLSearchParams();
  if (state.channel) q.set('canal', state.channel);
  if (state.days !== DEFAULT_PERIOD) q.set('periode', String(state.days));
  if (state.metric) q.set('metrique', state.metric);
  const s = q.toString();
  return s ? `${ANALYTICS_PATH}?${s}` : ANALYTICS_PATH;
}

// ---------------------------------------------------------------- séries

type Scope = ReadonlySet<string>;
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** Une quantité par jour, additionnée sur les canaux de `scope` ; un jour sans ligne vaut 0. */
export function flowValues(rows: readonly DailyMetricRow[], metric: DailyMetric, scope: Scope, days: readonly Day[]): number[] {
  const at = new Map(days.map((d, i) => [d, i] as const));
  const out = days.map(() => 0);
  for (const r of rows) {
    if (r.metric !== metric || !scope.has(r.integrationId)) continue;
    const i = at.get(r.day);
    if (i !== undefined) out[i]! += r.value;
  }
  return out;
}

interface Point { day: Day; value: number }

/** Relevés d'un niveau (abonnés) rangés par canal et par jour. */
function tracks(rows: readonly DailyMetricRow[], metric: DailyMetric, scope: Scope): Point[][] {
  const by = new Map<string, Point[]>();
  for (const r of rows) {
    if (r.metric !== metric || !scope.has(r.integrationId)) continue;
    const list = by.get(r.integrationId) ?? [];
    list.push({ day: r.day, value: r.value });
    by.set(r.integrationId, list);
  }
  return [...by.values()].map((p) => p.sort((a, b) => a.day.localeCompare(b.day)));
}

const lastOnOrBefore = (points: readonly Point[], day: Day): Point | undefined => {
  let found: Point | undefined;
  for (const p of points) if (p.day <= day) found = p;
  return found;
};
const firstOnOrAfter = (points: readonly Point[], day: Day): Point | undefined => points.find((p) => p.day >= day);

/**
 * Un niveau par jour, additionné sur les canaux : chaque canal garde son dernier relevé jusqu'au suivant. Un jour où aucun canal n'a encore
 * de relevé vaut null (inconnu, pas zéro).
 */
export function stockValues(rows: readonly DailyMetricRow[], metric: DailyMetric, scope: Scope, days: readonly Day[]): (number | null)[] {
  const out: (number | null)[] = days.map(() => null);
  for (const points of tracks(rows, metric, scope)) {
    let k = -1;
    days.forEach((d, i) => {
      while (k + 1 < points.length && points[k + 1]!.day <= d) k++;
      if (k >= 0) out[i] = (out[i] ?? 0) + points[k]!.value;
    });
  }
  return out;
}

// ---------------------------------------------------------------- variation

export interface Change {
  diff: number;
  /** Rapport à la période de comparaison (0,12 = +12 %) ; null quand elle valait 0 (aucune base de calcul). */
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
  /** `points` : `diff` est un écart entre deux taux (0,004 = +0,4 point), pas une quantité. */
  unit?: 'points';
}

/** Variation entre deux valeurs ; null si on ne peut pas comparer (période précédente inconnue). */
export function variation(now: number, before: number | null): Change | null {
  if (before === null) return null;
  const diff = now - before;
  return { diff, percent: before === 0 ? null : diff / Math.abs(before), direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

// ---------------------------------------------------------------- une métrique

export interface MetricSummary {
  id: CardMetric;
  /** Faux quand le réseau n'a rien fourni pour ce périmètre : la carte affiche « pas encore de données », pas un zéro. */
  available: boolean;
  /** Flux : total de la période. Niveau : valeur au dernier jour connu. */
  value: number | null;
  /** Flux : total de la période précédente. Niveau : valeur au début de la période. */
  previous: number | null;
  change: Change | null;
  /** Une valeur par jour de la période (null = inconnue). */
  values: (number | null)[];
}

/**
 * Les métriques d'activité sont toujours disponibles : zéro publication est une vraie réponse. Les métriques d'audience ne le sont que si
 * des lignes existent, sinon on afficherait des zéros qui ressemblent à des mesures.
 */
export function summarizeMetric(rows: readonly DailyMetricRow[], metric: CardMetric, scope: Scope, w: Windows): MetricSummary {
  if (metric === 'engagementRate') return rateSummary(rows, scope, w);
  const own = rows.filter((r) => r.metric === metric && scope.has(r.integrationId));
  const available = !isAudienceMetric(metric) || own.length > 0;
  if (!available) return { id: metric, available, value: null, previous: null, change: null, values: w.days.map(() => null) };

  if (METRIC_KIND[metric] === 'stock') {
    // Variation calculée sur les seuls canaux suivis aux deux bouts : connecter un canal de plus ne passe pas pour une croissance.
    let value: number | null = null;
    let base = 0;
    let gain = 0;
    let compared = false;
    for (const points of tracks(own, metric as DailyMetric, scope)) {
      const end = lastOnOrBefore(points, w.to);
      if (!end) continue;
      value = (value ?? 0) + end.value;
      const start = lastOnOrBefore(points, w.prevTo) ?? firstOnOrAfter(points, w.from);
      if (!start || start === end) continue;
      base += start.value;
      gain += end.value - start.value;
      compared = true;
    }
    return {
      id: metric, available, value, previous: compared ? base : null, change: compared ? variation(base + gain, base) : null,
      values: stockValues(own, metric as DailyMetric, scope, w.days),
    };
  }

  const values = flowValues(own, metric as DailyMetric, scope, w.days);
  const value = sum(values);
  const hadPrevious = !isAudienceMetric(metric) || own.some((r) => r.day >= w.prevFrom && r.day <= w.prevTo);
  const previous = hadPrevious ? sum(flowValues(own, metric as DailyMetric, scope, w.prevDays)) : null;
  return { id: metric, available, value, previous, change: variation(value, previous), values };
}

/** Seuil sous lequel un écart de taux est affiché stable (0,05 point). */
const RATE_EPSILON = 0.0005;

/**
 * Taux d'engagement = interactions ÷ portée, calculé sur les totaux de la période (jamais en moyennant des taux journaliers). Disponible
 * seulement quand le périmètre a des relevés des deux métriques. La variation est un écart en points, pas en pourcentage.
 */
function rateSummary(rows: readonly DailyMetricRow[], scope: Scope, w: Windows): MetricSummary {
  const mine = rows.filter((r) => scope.has(r.integrationId));
  const hasBoth = mine.some((r) => r.metric === 'engagement') && mine.some((r) => r.metric === 'reach');
  if (!hasBoth) return { id: 'engagementRate', available: false, value: null, previous: null, change: null, values: w.days.map(() => null) };
  const eng = flowValues(mine, 'engagement', scope, w.days);
  const reach = flowValues(mine, 'reach', scope, w.days);
  const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
  const value = ratio(sum(eng), sum(reach));
  const prevReach = sum(flowValues(mine, 'reach', scope, w.prevDays));
  const previous = ratio(sum(flowValues(mine, 'engagement', scope, w.prevDays)), prevReach);
  let change: Change | null = null;
  if (value !== null && previous !== null) {
    const diff = value - previous;
    change = { diff, percent: null, direction: diff > RATE_EPSILON ? 'up' : diff < -RATE_EPSILON ? 'down' : 'flat', unit: 'points' };
  }
  return { id: 'engagementRate', available: true, value, previous, change, values: reach.map((d, i) => ratio(eng[i]!, d)) };
}

export interface MetricDetail {
  summary: MetricSummary;
  /** Flux : moyenne par jour. Niveau : évolution moyenne par jour. */
  average: number | null;
  /** Le jour le plus fort d'un flux (rien si la période est vide). */
  peak: { day: Day; value: number } | null;
}

export function metricDetail(summary: MetricSummary, w: Windows): MetricDetail {
  if (!summary.available || summary.value === null) return { summary, average: null, peak: null };
  const n = Math.max(1, w.days.length);
  if (METRIC_KIND[summary.id] === 'ratio') return { summary, average: null, peak: null };
  if (METRIC_KIND[summary.id] === 'stock') return { summary, average: summary.change ? summary.change.diff / n : null, peak: null };
  let peak: MetricDetail['peak'] = null;
  for (const [i, v] of summary.values.entries()) {
    if (v !== null && v > 0 && (peak === null || v >= peak.value)) peak = { day: w.days[i]!, value: v };
  }
  return { summary, average: summary.value / n, peak };
}

// ---------------------------------------------------------------- tableau par canal, publications récentes, file de publication

/** Une ligne du tableau : la valeur de chaque métrique pour un canal (null = pas de donnée). */
export interface PerformanceRow {
  integrationId: string;
  values: Partial<Record<CardMetric, number | null>>;
}

export interface PerformanceTable {
  metrics: CardMetric[];
  /** Triées par la métrique choisie, du plus fort au plus faible ; les canaux sans donnée à la fin. */
  rows: PerformanceRow[];
  /** Tous canaux confondus. */
  total: Partial<Record<CardMetric, number | null>>;
}

export function performanceTable(rows: readonly DailyMetricRow[], metrics: readonly CardMetric[], channelIds: readonly string[], sortBy: CardMetric, w: Windows): PerformanceTable {
  const valueOf = (scope: Scope, m: CardMetric) => {
    const s = summarizeMetric(rows, m, scope, w);
    return s.available ? s.value : null;
  };
  const lines = channelIds.map((id): PerformanceRow => {
    const scope = new Set([id]);
    return { integrationId: id, values: Object.fromEntries(metrics.map((m) => [m, valueOf(scope, m)])) };
  });
  const everyone = new Set(channelIds);
  const rank = (r: PerformanceRow) => r.values[sortBy] ?? Number.NEGATIVE_INFINITY;
  lines.sort((a, b) => rank(b) - rank(a)); // Array.prototype.sort est stable : à égalité, l'ordre des canaux est gardé
  return { metrics: [...metrics], rows: lines, total: Object.fromEntries(metrics.map((m) => [m, valueOf(everyone, m)])) };
}

/** Les dernières publications envoyées dans la période choisie, pour les canaux du périmètre. */
export function recentPosts(posts: readonly RecentPost[], scope: Scope, w: Windows, limit = 6): RecentPost[] {
  return posts
    .filter((p) => {
      const day = Number.isNaN(Date.parse(p.at)) ? '' : dayKey(new Date(p.at));
      return scope.has(p.integrationId) && day >= w.from && day <= w.to;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

export interface QueueSummary {
  upcoming: number;
  drafts: number;
}

export function queueSummary(queue: readonly QueueCount[], scope: Scope): QueueSummary {
  const mine = queue.filter((q) => scope.has(q.integrationId));
  return { upcoming: sum(mine.map((q) => q.upcoming)), drafts: sum(mine.map((q) => q.drafts)) };
}

// ---------------------------------------------------------------- la page entière

export interface AnalyticsView {
  period: Period;
  channel: string | null;
  /** La métrique affichée en grand (celle de l'adresse si elle existe, sinon la première qui a des données). */
  metric: CardMetric;
  windows: Windows;
  /** Y a-t-il des statistiques d'audience pour au moins un canal ? Sinon les cartes d'audience ne sont pas affichées. */
  audience: boolean;
  cards: MetricSummary[];
  detail: MetricDetail;
  /** Tous les canaux côte à côte, quel que soit le canal choisi (c'est un comparatif). */
  table: PerformanceTable;
  recent: RecentPost[];
  queue: QueueSummary;
  /** Canaux affichés dont le réseau refuse les statistiques faute d'autorisation : à reconnecter pour les obtenir. */
  reconnect: string[];
}

export function buildView(input: { data: Pick<AnalyticsData, 'rows' | 'queue' | 'recent'> & { collection?: ChannelCollection[] }; channelIds: readonly string[]; state: AnalyticsState; today: Day }): AnalyticsView {
  const { data, channelIds, state, today } = input;
  const windows = periodWindows(state.days, today);
  const visible = new Set(channelIds);
  // Seuls les canaux affichés comptent : le total « tous les canaux » est toujours la somme des lignes du tableau.
  const rows = data.rows.filter((r) => visible.has(r.integrationId));
  const channel = state.channel && visible.has(state.channel) ? state.channel : null;
  const scope: Scope = channel ? new Set([channel]) : visible;

  const audience = rows.some((r) => isAudienceMetric(r.metric));
  const shown = audience ? CARD_METRICS : ACTIVITY_METRICS;
  const cards = shown.map((m) => summarizeMetric(rows, m, scope, windows));
  const metric = (cards.find((c) => c.id === state.metric) ?? cards.find((c) => c.available) ?? cards[0]!).id;
  const summary = cards.find((c) => c.id === metric)!;

  return {
    period: state.days, channel, metric, windows, audience, cards,
    detail: metricDetail(summary, windows),
    table: performanceTable(rows, shown, channelIds, metric, windows),
    recent: recentPosts(data.recent, scope, windows),
    queue: queueSummary(data.queue, scope),
    reconnect: channelIds.filter((id) => (data.collection ?? []).some((c) => c.integrationId === id && c.status === 'missing_scope')),
  };
}

// ---------------------------------------------------------------- d'où viennent les chiffres d'activité

export interface PostFact {
  integrationId: string;
  state: string;
  /** Date de publication prévue (ISO). */
  at: string;
}
export interface MessageFact {
  integrationId: string;
  direction: string;
  deliveryStatus: string;
  at: string;
}

/**
 * Transforme des publications et des messages en lignes quotidiennes. Publiée = `published` ; échec = `error` ou `unknown` (à vérifier) ;
 * messages reçus = entrants ; réponses = sortants réellement envoyés (`sent`). Le reste (brouillons, programmées, échecs d'envoi d'un
 * message) n'est pas une activité.
 */
export function activityRows(posts: readonly PostFact[], messages: readonly MessageFact[], window: { from: Day; to: Day }): DailyMetricRow[] {
  const counts = new Map<string, DailyMetricRow>();
  const add = (integrationId: string, at: string, metric: DailyMetric) => {
    const time = Date.parse(at);
    if (Number.isNaN(time)) return;
    const day = dayKey(new Date(time));
    if (day < window.from || day > window.to) return;
    const key = `${integrationId}|${day}|${metric}`;
    const row = counts.get(key);
    if (row) row.value += 1;
    else counts.set(key, { integrationId, day, metric, value: 1 });
  };
  for (const p of posts) {
    if (p.state === 'published') add(p.integrationId, p.at, 'published');
    else if (p.state === 'error' || p.state === 'unknown') add(p.integrationId, p.at, 'failed');
  }
  for (const m of messages) {
    if (m.direction === 'in') add(m.integrationId, m.at, 'received');
    else if (m.direction === 'out' && m.deliveryStatus === 'sent') add(m.integrationId, m.at, 'replies');
  }
  return [...counts.values()].sort((a, b) => a.day.localeCompare(b.day) || a.integrationId.localeCompare(b.integrationId) || a.metric.localeCompare(b.metric));
}

export interface QueuedFact {
  integrationId: string;
  state: string;
  at: string | null;
}

/** Programmées dans les 7 prochains jours (en file ou en cours d'envoi) et brouillons, par canal. */
export function queueCounts(posts: readonly QueuedFact[], now: Date): QueueCount[] {
  const from = now.getTime();
  const to = from + 7 * DAY_MS;
  const by = new Map<string, QueueCount>();
  const entry = (id: string) => {
    let e = by.get(id);
    if (!e) by.set(id, (e = { integrationId: id, upcoming: 0, drafts: 0 }));
    return e;
  };
  for (const p of posts) {
    if (p.state === 'draft') entry(p.integrationId).drafts += 1;
    else if ((p.state === 'queued' || p.state === 'publishing') && p.at) {
      const t = Date.parse(p.at);
      if (t >= from && t < to) entry(p.integrationId).upcoming += 1;
    }
  }
  return [...by.values()];
}

// ---------------------------------------------------------------- relevés d'audience lus en base

const STORED_METRICS: readonly string[] = ['followers', 'reach', 'engagement'];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/** Lignes de `channel_metrics_daily` (telles que PostgREST les renvoie) en lignes quotidiennes ; une ligne illisible est ignorée, jamais lue comme zéro. */
export function metricRowsFromDb(rows: readonly Record<string, unknown>[]): DailyMetricRow[] {
  return rows.flatMap((r): DailyMetricRow[] => {
    const value = typeof r.value === 'string' && r.value.trim() !== '' ? Number(r.value) : r.value;
    if (typeof r.integration_id !== 'string' || typeof r.day !== 'string' || !DAY_PATTERN.test(r.day)) return [];
    if (typeof r.metric !== 'string' || !STORED_METRICS.includes(r.metric)) return [];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return [];
    return [{ integrationId: r.integration_id, day: r.day.slice(0, 10), metric: r.metric as DailyMetric, value }];
  });
}
