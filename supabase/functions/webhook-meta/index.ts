// Edge Function : réception des webhooks Meta (Messenger, Instagram, commentaires).
// Déploiement : supabase functions deploy webhook-meta --no-verify-jwt   (Meta n'envoie pas de JWT Supabase)
// URL à saisir dans le tableau de bord Meta : https://<projet>.supabase.co/functions/v1/webhook-meta
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleMetaWebhook, type WebhookDb } from '../_shared/meta/handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const db: WebhookDb = {
  async insertRawEvent(provider, payload) {
    const { data, error } = await supabase.from('inbox_events_raw').insert({ provider, payload }).select('id').single();
    if (error) throw error;
    return data.id as string;
  },
  async findIntegration(provider, internalId) {
    const { data, error } = await supabase
      .from('integrations')
      .select('id')
      .eq('provider', provider)
      .eq('internal_id', internalId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async ingest(integrationId, e) {
    const { error } = await supabase.rpc('ingest_message', {
      p_integration_id: integrationId,
      p_kind: e.kind,
      p_conversation_external_id: e.conversationExternalId,
      p_contact_external_id: e.contact.id,
      p_contact_name: e.contact.name ?? null,
      p_contact_username: e.contact.username ?? null,
      p_contact_avatar_url: null,
      p_message_external_id: e.messageExternalId,
      p_direction: e.direction,
      p_body: e.body,
      p_attachments: e.attachments,
      p_sent_at: e.sentAt,
      p_raw: null,
      p_target_external_id: e.targetExternalId ?? null,
    });
    if (error) throw error;
  },
  async markProcessed(rawEventId, error) {
    await supabase
      .from('inbox_events_raw')
      .update({ processed_at: new Date().toISOString(), error: error ?? null })
      .eq('id', rawEventId);
  },
};

Deno.serve((req) =>
  handleMetaWebhook(req, { appSecret: Deno.env.get('META_APP_SECRET') ?? '', verifyToken: Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '' }, db)
);
