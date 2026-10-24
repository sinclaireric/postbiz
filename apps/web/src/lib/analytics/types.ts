// Contrat de données de la page Analyses.
//
// Tout part de lignes « une valeur par canal, par jour et par métrique » (`DailyMetricRow`). La page n'en fait que des sommes,
// des comparaisons et des courbes : d'où viennent les lignes (calculées à la volée à partir des publications et des messages,
// lues dans une table de statistiques, ou fabriquées pour la démo) est l'affaire du dépôt de données (`AnalyticsRepository`).

/** Périodes proposées, en jours (comme Postiz : 7, 30 et 90 jours). */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 30;

/** Audience : ce que les réseaux savent de vos abonnés et de la portée de vos contenus. Pas encore collectée par Postbiz. */
export const AUDIENCE_METRICS = ['followers', 'reach', 'engagement', 'engagementRate'] as const;
/** Activité : ce que Postbiz sait lui-même (publications envoyées, messages reçus, réponses et échecs). Calculée à partir de la base. */
export const ACTIVITY_METRICS = ['published', 'received', 'replies', 'failed'] as const;
/** Les métriques qu'on peut afficher en carte et choisir, dans l'ordre d'affichage. */
export const CARD_METRICS = [...AUDIENCE_METRICS, ...ACTIVITY_METRICS] as const;
export type CardMetric = (typeof CARD_METRICS)[number];
/**
 * Métriques stockées, une valeur par canal et par jour. Le taux d'engagement n'en fait pas partie : il se calcule (interactions ÷ portée)
 * à partir de deux métriques stockées, donc aucune source n'a à le fournir.
 */
export type DailyMetric = Exclude<CardMetric, 'engagementRate'>;

/**
 * - `flow` : une quantité par jour qu'on additionne sur la période (publications, portée, interactions…) ;
 * - `stock` : un niveau en fin de journée, qu'on ne peut pas additionner (nombre d'abonnés) ;
 * - `ratio` : un rapport entre deux flux (taux d'engagement), jamais additionné : on divise les totaux.
 */
export type MetricKind = 'flow' | 'stock' | 'ratio';
export const METRIC_KIND: Record<CardMetric, MetricKind> = {
  followers: 'stock', reach: 'flow', engagement: 'flow', engagementRate: 'ratio', published: 'flow', received: 'flow', replies: 'flow', failed: 'flow',
};

/** Ici une hausse est une mauvaise nouvelle : sa variation se colore à l'envers. */
export const LOWER_IS_BETTER: readonly CardMetric[] = ['failed'];

export const isAudienceMetric = (m: CardMetric): boolean => (AUDIENCE_METRICS as readonly string[]).includes(m);

/** Un jour civil en UTC, « 2026-10-24 ». */
export type Day = string;

export interface DailyMetricRow {
  integrationId: string;
  day: Day;
  metric: DailyMetric;
  value: number;
}

/** Ce qui attend dans la file de publication d'un canal (instantané, sans historique). */
export interface QueueCount {
  integrationId: string;
  /** Publications programmées dans les 7 prochains jours. */
  upcoming: number;
  drafts: number;
}

/** Bornes incluses. */
export interface DayWindow {
  from: Day;
  to: Day;
}

/** Une publication envoyée, pour la liste des publications récentes. */
export interface RecentPost {
  id: string;
  integrationId: string;
  content: string;
  /** Date de publication (ISO). */
  at: string;
  /** Adresse de la publication sur le réseau, si on la connaît. */
  url: string | null;
}

/** Où en est la collecte des statistiques d'un canal (worker) : jamais collecté, à jour, autorisation à renouveler, ou en panne passagère. */
export type CollectionStatus = 'pending' | 'ok' | 'missing_scope' | 'error';
export interface ChannelCollection {
  integrationId: string;
  status: CollectionStatus;
}

export interface AnalyticsData {
  rows: DailyMetricRow[];
  /** État de la collecte des statistiques d'audience, canal par canal (vide en démo). */
  collection: ChannelCollection[];
  queue: QueueCount[];
  /** Les dernières publications envoyées sur la fenêtre (de la plus récente à la plus ancienne), tous canaux confondus. */
  recent: RecentPost[];
  /** Trop de lignes pour tout lire : les totaux sont partiels. */
  truncated: boolean;
  /** Une requête a échoué : les chiffres affichés seraient faux, la page le dit. */
  error: boolean;
}

export interface AnalyticsRepository {
  /** Lignes de tous les canaux de l'organisation sur `window` (la période choisie et la précédente), et la file de publication à `now`. */
  load(window: DayWindow, now?: Date): Promise<AnalyticsData>;
}
