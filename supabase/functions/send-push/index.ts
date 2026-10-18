// Edge Function : envoie les notifications push (Expo) aux appareils enregistrés par apps/mobile.
// Appelée par les triggers Postgres de la migration 20261019000001_push.sql (pg_net), jamais par un client.
// Déploiement : supabase functions deploy send-push --no-verify-jwt
//   supabase secrets set PUSH_WEBHOOK_SECRET=<chaîne aléatoire>   (la même valeur dans le Vault, voir README)
//   facultatif : EXPO_ACCESS_TOKEN si « Enhanced Security for Push Notifications » est activé chez Expo
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handlePushWebhook, type PushDb } from '../_shared/push/handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const db: PushDb = {
  async getConversation(id) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, org_id, kind, assignee_id, contacts(name, username)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const contact = Array.isArray(data.contacts) ? data.contacts[0] : data.contacts;
    return {
      id: data.id,
      orgId: data.org_id,
      kind: data.kind,
      assigneeId: data.assignee_id,
      contactName: contact?.name ?? null,
      contactUsername: contact?.username ?? null,
    };
  },
  async listResponderIds(orgId) {
    const { data, error } = await supabase.from('memberships').select('user_id').eq('org_id', orgId).in('role', ['admin', 'member']);
    if (error) throw error;
    return (data ?? []).map((m) => m.user_id as string);
  },
  async getTokens(userIds) {
    const { data, error } = await supabase.from('push_tokens').select('user_id, token').in('user_id', userIds);
    if (error) throw error;
    return (data ?? []).map((t) => ({ userId: t.user_id as string, token: t.token as string }));
  },
  async deleteTokens(tokens) {
    const { error } = await supabase.from('push_tokens').delete().in('token', tokens);
    if (error) throw error;
  },
};

Deno.serve((req) =>
  handlePushWebhook(req, { webhookSecret: Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '' }, db, {
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') || undefined,
  })
);
