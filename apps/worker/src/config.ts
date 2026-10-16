export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  tokenEncryptionKey: string;
  dryRun: boolean;
  pollIntervalMs: number;
  postBatch: number;
  messageBatch: number;
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
    postBatch: int(env.WORKER_POST_BATCH, 5),
    messageBatch: int(env.WORKER_MESSAGE_BATCH, 20),
  };
}
