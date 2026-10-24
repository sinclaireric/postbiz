/**
 * Média d'une publication, prêt à être envoyé : les adresses sont des URL signées temporaires du stockage privé (que le réseau peut télécharger),
 * valables quelques heures. Le fournisseur choisit ce dont il a besoin (le fichier, sa version JPEG, sa vignette).
 */
export interface ResolvedMedia {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mimeType: string | null;
  /** Texte alternatif de ce média dans cette publication ('' si aucun). */
  alt: string;
  /** Le fichier d'origine. */
  url: string;
  /** Version JPEG d'une image qui n'en était pas une (Instagram n'accepte que le JPEG) ; null si le fichier est déjà un JPEG ou une vidéo. */
  jpegUrl: string | null;
  thumbnailUrl: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface PublishInput {
  accessToken: string;
  integration: { id: string; internalId: string; settings: Record<string, unknown> };
  /** Publication racine en premier, puis les éventuelles suites (fil). */
  posts: { id: string; content: string; media: ResolvedMedia[]; settings: Record<string, unknown> }[];
}

export interface PublishResult {
  releaseId: string;
  releaseUrl: string | null;
}

export interface CommentInput {
  accessToken: string;
  integration: { id: string; internalId: string; settings: Record<string, unknown> };
  /** Identifiant de la publication chez le réseau (`posts.release_id`), sous laquelle on commente. */
  releaseId: string;
  text: string;
}

export interface CommentResult {
  commentId: string;
}

export interface RefreshInput {
  refreshToken: string;
  integration: { id: string; internalId: string; settings: Record<string, unknown> };
}

export interface RefreshedTokens {
  accessToken: string;
  /** `null` : le réseau n'a pas émis de nouveau refresh token, on garde l'ancien. */
  refreshToken: string | null;
  /** `null` : le jeton n'expire pas. */
  expiresAt: Date | null;
}

/** Un relevé : la valeur d'une métrique d'audience pour un jour (UTC, « 2026-10-24 »). `followers` est un niveau, les autres des quantités du jour. */
export interface MetricPoint {
  day: string;
  metric: 'followers' | 'reach' | 'engagement';
  value: number;
}

export interface MetricsInput {
  accessToken: string;
  integration: { id: string; internalId: string; settings: Record<string, unknown> };
  /** Premier passage sur ce canal : remonter tout l'historique que le réseau donne (jusqu'à 90 jours) ; sinon, seulement les derniers jours. */
  backfill: boolean;
  /** Aujourd'hui, en UTC (« 2026-10-24 »). */
  today: string;
}

export interface MetricsResult {
  points: MetricPoint[];
  /** Une partie des métriques n'a pas pu être lue : `missing_scope` (autorisation à renouveler) ou `error` (passager). Les relevés lus sont gardés. */
  problem?: { kind: 'missing_scope' | 'error'; message: string };
}

export interface SocialProvider {
  id: string;
  supportsThreads: boolean;
  supportsMedia: boolean;
  /** Publie et renvoie un résultat par entrée de `posts`. Doit lever les erreurs de `errors.ts`. */
  publish(input: PublishInput): Promise<PublishResult[]>;
  /**
   * Publie un commentaire sous une publication déjà publiée (premier commentaire ; sur X, une réponse). Absent si le réseau ne le permet
   * pas encore. Doit lever les erreurs de `errors.ts`, avec la même règle : une issue incertaine n'est jamais rejouée.
   */
  comment?(input: CommentInput): Promise<CommentResult>;
  /**
   * Échange un refresh token contre de nouveaux jetons. Absent si le réseau n'a rien à rafraîchir.
   * Lève ReconnectRequiredError (refus définitif : il faut reconnecter) ou RefreshTransientError (réessayer plus tard).
   */
  refreshToken?(input: RefreshInput): Promise<RefreshedTokens>;
  /**
   * Relève les statistiques d'audience du canal (abonnés, portée, interactions) ; absent si on ne sait pas les lire. Lève ReconnectRequiredError
   * si le jeton est refusé ; pour une panne partielle, renvoie les relevés lus et `problem`. Seul un échec total lève MissingScopeError /
   * MetricsUnavailableError.
   */
  metrics?(input: MetricsInput): Promise<MetricsResult>;
}
