// Ajoute un canal de test sans passer par l’OAuth : utile pour essayer la publication et l'inbox avec un jeton
// obtenu à la main (ex. jeton de Page dans l'explorateur de l'API Graph).
//
//   pnpm --filter @postbiz/worker add-channel -- --org <uuid> --provider facebook --internal-id <PAGE_ID> \
//     --name "Ma Page" --token <JETON_DE_PAGE> [--username ...] [--settings '{"human_agent_enabled":true}']
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '@postbiz/core';
import { loadConfig } from '../src/config.ts';
import { buildChannelRows, parseAddChannelArgs } from '../src/channel.ts';

const args = parseAddChannelArgs(process.argv.slice(2));
const cfg = loadConfig();
const supabase = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, { auth: { persistSession: false } });

const rows = await buildChannelRows(args, (plain) => encryptSecret(plain, cfg.tokenEncryptionKey));

const { data: integration, error } = await supabase
  .from('integrations')
  .upsert(rows.integration, { onConflict: 'org_id,provider,internal_id' })
  .select('id')
  .single();
if (error) throw new Error(`Création du canal : ${error.message}`);

const { error: secretError } = await supabase
  .from('integration_secrets')
  .upsert({ integration_id: integration.id, access_token_enc: rows.accessTokenEnc }, { onConflict: 'integration_id' });
if (secretError) throw new Error(`Enregistrement du jeton : ${secretError.message}`);

console.log(`Canal prêt : ${integration.id} (${args.provider} · ${args.name})`);
