import { createClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret } from '@postbiz/core';
import { loadConfig } from './config.ts';
import { createSupabaseWorkerDb } from './engine/db.ts';
import { collectMetrics, createSupabaseMetricsDb } from './engine/metrics.ts';
import { createSupabaseRefreshDb, refreshTokens } from './engine/refresh.ts';
import { tick } from './engine/tick.ts';
import { createRegistry } from './providers/registry.ts';

const log = (msg: string, extra?: unknown) => console.log(`[${new Date().toISOString()}] ${msg}`, extra ?? '');

async function main() {
  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = createSupabaseWorkerDb(supabase, (enc) => decryptSecret(enc, cfg.tokenEncryptionKey));
  const providers = createRegistry({ dryRun: cfg.dryRun });
  const refreshDb = createSupabaseRefreshDb(supabase, {
    encrypt: (plain) => encryptSecret(plain, cfg.tokenEncryptionKey),
    decrypt: (enc) => decryptSecret(enc, cfg.tokenEncryptionKey),
  });
  const metricsDb = createSupabaseMetricsDb(supabase, (enc) => decryptSecret(enc, cfg.tokenEncryptionKey));
  let lastRefresh = 0;
  let lastMetrics = 0;

  log(`Worker Postbiz démarré${cfg.dryRun ? ' (MODE ESSAI : aucun réseau n’est contacté)' : ''}`);

  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { log(`${sig} reçu, arrêt après le passage en cours`); stopping = true; });

  while (!stopping) {
    try {
      await tick({ supabase, db, providers }, { posts: cfg.postBatch, messages: cfg.messageBatch, comments: cfg.commentBatch }, log);
    } catch (e) {
      log('passage en échec', (e as Error).message);
    }
    // En mode essai on ne contacte aucun réseau : pas de rafraîchissement.
    if (!cfg.dryRun && Date.now() - lastRefresh >= cfg.refreshIntervalMs) {
      lastRefresh = Date.now();
      try {
        const s = await refreshTokens({ db: refreshDb, providers }, {}, log);
        if (s.refreshed || s.reconnectNeeded || s.expired) log('jetons', s);
      } catch (e) {
        log('rafraîchissement des jetons en échec', (e as Error).message);
      }
    }
    // Statistiques d'audience des canaux (abonnés, portée, interactions) : relevées auprès des réseaux, donc jamais en mode essai.
    if (!cfg.dryRun && Date.now() - lastMetrics >= cfg.metricsIntervalMs) {
      lastMetrics = Date.now();
      try {
        const s = await collectMetrics({ db: metricsDb, providers }, { limit: cfg.metricsBatch }, log);
        if (s.collected || s.partial || s.missingScope || s.reconnectNeeded || s.errors) log('statistiques', s);
      } catch (e) {
        log('collecte des statistiques en échec', (e as Error).message);
      }
    }
    await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
  }
  log('Worker arrêté');
}

void main();
