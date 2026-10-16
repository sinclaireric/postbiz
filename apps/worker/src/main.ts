import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from '@postbiz/core';
import { loadConfig } from './config.ts';
import { createSupabaseWorkerDb } from './engine/db.ts';
import { tick } from './engine/tick.ts';
import { createRegistry } from './providers/registry.ts';

const log = (msg: string, extra?: unknown) => console.log(`[${new Date().toISOString()}] ${msg}`, extra ?? '');

async function main() {
  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = createSupabaseWorkerDb(supabase, (enc) => decryptSecret(enc, cfg.tokenEncryptionKey));
  const providers = createRegistry({ dryRun: cfg.dryRun });

  log(`Worker Postbiz démarré${cfg.dryRun ? ' (MODE ESSAI : aucun réseau n’est contacté)' : ''}`);

  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { log(`${sig} reçu, arrêt après le passage en cours`); stopping = true; });

  while (!stopping) {
    try {
      await tick({ supabase, db, providers }, { posts: cfg.postBatch, messages: cfg.messageBatch }, log);
    } catch (e) {
      log('passage en échec', (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
  }
  log('Worker arrêté');
}

void main();
