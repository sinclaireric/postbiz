// Edge Function : l'« Agent » de l'application mobile. Transforme un brief en publications adaptées à chaque réseau.
// Appelée par un utilisateur connecté (le JWT est vérifié par Supabase : verify_jwt = true, valeur par défaut).
// Déploiement :
//   supabase functions deploy agent-compose
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        (jamais côté application)
//   facultatif : AGENT_MODEL (par défaut claude-sonnet-5-5)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCompose, type ComposeDeps } from '../_shared/agent/compose.ts';

const MODEL = Deno.env.get('AGENT_MODEL') || 'claude-sonnet-5-5';

/** Client agissant au nom de l'utilisateur : c'est la RLS qui décide de ce qu'il voit. */
const asUser = (req: Request) =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });

const deps: ComposeDeps = {
  async authenticate(req) {
    const { data, error } = await asUser(req).auth.getUser();
    return error ? null : (data.user?.id ?? null);
  },
  async canCompose(userId, req) {
    const { data, error } = await asUser(req).from('memberships').select('role').eq('user_id', userId).in('role', ['admin', 'member']).limit(1);
    return !error && (data?.length ?? 0) > 0;
  },
  async callModel(system, user) {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  },
};

Deno.serve((req) => handleCompose(req, deps));
