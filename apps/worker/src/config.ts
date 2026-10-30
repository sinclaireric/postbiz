export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  tokenEncryptionKey: string;
  dryRun: boolean;
  pollIntervalMs: number;
  refreshIntervalMs: number;
  metricsIntervalMs: number;
  metricsBatch: number;
  postBatch: number;
  messageBatch: number;
  commentBatch: number;
  /** Lecture des documents et des sites de la base de connaissance (désactivable : WORKER_KNOWLEDGE=0). */
  knowledge: boolean;
  knowledgeIntervalMs: number;
  /** Comment le robot de lecture des sites s'annonce (User-Agent). */
  userAgent: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TOKEN_ENCRYPTION_KEY'].filter((k) => !env[k] && !(k === 'SUPABASE_URL' && env.NEXT_PUBLIC_SUPABASE_URL));
  if (missing.length > 0) throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')} (voir .env.example)`);
  const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  return {
    supabaseUrl: (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL)!,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY!,
    dryRun: env.WORKER_DRY_RUN === '1',
    pollIntervalMs: int(env.WORKER_POLL_INTERVAL_MS, 5_000),
    refreshIntervalMs: int(env.WORKER_REFRESH_INTERVAL_MS, 60_000),
    // La collecte des statistiques ne presse pas : un passage toutes les 5 minutes réclame les canaux dont l'échéance (6 h) est passée.
    metricsIntervalMs: int(env.WORKER_METRICS_INTERVAL_MS, 300_000),
    metricsBatch: int(env.WORKER_METRICS_BATCH, 10),
    postBatch: int(env.WORKER_POST_BATCH, 5),
    messageBatch: int(env.WORKER_MESSAGE_BATCH, 20),
    commentBatch: int(env.WORKER_COMMENT_BATCH, 10),
    knowledge: env.WORKER_KNOWLEDGE !== '0',
    // Une source en attente est reprise dans les 10 secondes ; la file est vidée sans attendre tant qu'il y en a.
    knowledgeIntervalMs: int(env.WORKER_KNOWLEDGE_INTERVAL_MS, 10_000),
    // L'adresse donnée dans le User-Agent est la page /postbizbot du site : qui est ce robot, et comment le bloquer.
    userAgent: env.KNOWLEDGE_USER_AGENT?.trim() || `PostbizBot/1.0 (+${(env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '') || 'https://getpostbiz.com'}/postbizbot)`,
  };
}
