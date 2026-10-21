// Accès aux données du worker. Interfaces pour les tests, implémentation Supabase (service_role) en production.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WorkerIntegration {
  id: string;
  orgId: string;
  provider: string;
  internalId: string;
  name: string;
  status: 'active' | 'refresh_needed' | 'disabled';
  settings: Record<string, unknown>;
}

export interface WorkerPost {
  id: string;
  orgId: string;
  integrationId: string;
  content: string;
  media: unknown[];
  settings: Record<string, unknown>;
  createdBy: string | null;
  /** Identifiant de la publication chez le réseau, une fois publiée. */
  releaseId: string | null;
  firstComment: string | null;
}

export interface WorkerMessage {
  id: string;
  orgId: string;
  conversationId: string;
  body: string | null;
  sentBy: string | null;
}

export interface WorkerConversation {
  id: string;
  integrationId: string;
  kind: 'dm' | 'comment_thread';
  externalId: string;
  contactPlatformId: string;
  lastInboundAt: string | null;
  replyWindowExpiresAt: string | null;
}

export interface WorkerDb {
  getIntegration(id: string): Promise<WorkerIntegration | null>;
  getAccessToken(integrationId: string): Promise<string | null>;
  markIntegrationRefreshNeeded(integrationId: string): Promise<void>;
  notify(n: { userId: string | null; orgId: string; type: string; title: string; body: string; data?: Record<string, unknown> }): Promise<void>;

  // publications
  getChildren(postId: string): Promise<WorkerPost[]>;
  markPublished(postId: string, r: { releaseId: string; releaseUrl: string | null }): Promise<void>;
  markPostFailed(postId: string, state: 'error' | 'unknown', message: string): Promise<void>;
  completeFirstComment(postId: string, commentId: string): Promise<void>;
  failFirstComment(postId: string, state: 'failed' | 'unknown', message: string): Promise<void>;

  // messages sortants
  getConversation(id: string): Promise<WorkerConversation | null>;
  completeMessage(messageId: string, externalId: string): Promise<void>;
  failMessage(messageId: string, message: string): Promise<void>;
}

type Row = Record<string, any>;
const one = <T extends Row>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export function createSupabaseWorkerDb(supabase: SupabaseClient, decrypt: (enc: string) => Promise<string>): WorkerDb {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what} : ${error.message}`);
  };

  return {
    async getIntegration(id) {
      const { data, error } = await supabase.from('integrations').select('id, org_id, provider, internal_id, name, status, settings').eq('id', id).is('deleted_at', null).maybeSingle();
      check(error, 'lecture du canal');
      if (!data) return null;
      return { id: data.id, orgId: data.org_id, provider: data.provider, internalId: data.internal_id, name: data.name, status: data.status, settings: data.settings ?? {} };
    },

    async getAccessToken(integrationId) {
      const { data, error } = await supabase.from('integration_secrets').select('access_token_enc').eq('integration_id', integrationId).maybeSingle();
      check(error, 'lecture du jeton');
      return data?.access_token_enc ? decrypt(data.access_token_enc) : null;
    },

    async markIntegrationRefreshNeeded(integrationId) {
      const { error } = await supabase.from('integrations').update({ status: 'refresh_needed' }).eq('id', integrationId);
      check(error, 'mise à jour du canal');
    },

    async notify(n) {
      if (!n.userId) return;
      const { error } = await supabase.from('notifications').insert({ user_id: n.userId, org_id: n.orgId, type: n.type, title: n.title, body: n.body, data: n.data ?? {} });
      check(error, 'création de la notification');
    },

    async getChildren(postId) {
      const { data, error } = await supabase.from('posts').select('id, org_id, integration_id, content, media, settings, created_by').eq('parent_post_id', postId).is('deleted_at', null).order('position', { ascending: true });
      check(error, 'lecture du fil');
      return (data ?? []).map((p: Row) => ({ id: p.id, orgId: p.org_id, integrationId: p.integration_id, content: p.content, media: p.media ?? [], settings: p.settings ?? {}, createdBy: p.created_by, releaseId: null, firstComment: null }));
    },

    async markPublished(postId, r) {
      // Condition sur l'état : on ne touche qu'un post réellement « en cours » (jamais un post déjà balayé ou modifié).
      const { error } = await supabase.from('posts').update({ state: 'published', release_id: r.releaseId, release_url: r.releaseUrl, error: null, locked_until: null }).eq('id', postId).eq('state', 'publishing');
      check(error, 'enregistrement de la publication');
    },

    async markPostFailed(postId, state, message) {
      const { error } = await supabase.from('posts').update({ state, error: message.slice(0, 1000), locked_until: null }).eq('id', postId).eq('state', 'publishing');
      check(error, 'enregistrement de l’échec');
    },

    async completeFirstComment(postId, commentId) {
      // Condition sur l'état : on ne conclut que pour un commentaire réellement « en cours » (jamais un commentaire déjà balayé).
      const { error } = await supabase.from('posts').update({ first_comment_state: 'posted', first_comment_id: commentId, first_comment_error: null, locked_until: null }).eq('id', postId).eq('first_comment_state', 'posting');
      check(error, 'enregistrement du commentaire');
    },

    async failFirstComment(postId, state, message) {
      const { error } = await supabase.from('posts').update({ first_comment_state: state, first_comment_error: message.slice(0, 1000), locked_until: null }).eq('id', postId).eq('first_comment_state', 'posting');
      check(error, 'enregistrement de l’échec du commentaire');
    },

    async getConversation(id) {
      const { data, error } = await supabase.from('conversations').select('id, integration_id, kind, external_id, last_inbound_at, reply_window_expires_at, contacts(platform_user_id)').eq('id', id).maybeSingle();
      check(error, 'lecture de la conversation');
      if (!data) return null;
      return {
        id: data.id, integrationId: data.integration_id, kind: data.kind, externalId: data.external_id,
        contactPlatformId: one<Row>(data.contacts)?.platform_user_id ?? '',
        lastInboundAt: data.last_inbound_at ?? null, replyWindowExpiresAt: data.reply_window_expires_at ?? null,
      };
    },

    async completeMessage(messageId, externalId) {
      const { error } = await supabase.rpc('complete_outbound_message', { p_message_id: messageId, p_external_id: externalId });
      check(error, 'confirmation de l’envoi');
    },

    async failMessage(messageId, message) {
      const { error } = await supabase.rpc('fail_outbound_message', { p_message_id: messageId, p_error: message });
      check(error, 'enregistrement de l’échec d’envoi');
    },
  };
}
