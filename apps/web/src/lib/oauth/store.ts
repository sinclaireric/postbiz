import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetworkId } from '@postbiz/core';
import type { ChannelForDisconnect, ChannelWrite, OAuthStore, PendingSelection, StoredState } from './flow';

// Implémentation Supabase du stockage. À utiliser UNIQUEMENT avec le client service_role (côté serveur) : les
// tables concernées sont fermées aux clients par la base. ⚠️ Non testée contre un projet Supabase réel
// (les fonctions SQL appelées le sont dans packages/db, avec PGlite).
const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`${what} : ${error.message}`);
};

export function createSupabaseOAuthStore(admin: SupabaseClient): OAuthStore {
  return {
    async saveState(r) {
      const { error } = await admin.from('oauth_states').insert({
        state_hash: r.stateHash, user_id: r.userId, org_id: r.orgId, network: r.network, code_verifier_enc: r.codeVerifierEnc, expires_at: r.expiresAt.toISOString(),
      });
      check(error, 'enregistrement de l’état de connexion');
    },

    async consumeState(stateHash) {
      const { data, error } = await admin.from('oauth_states').delete().eq('state_hash', stateHash).select('user_id, org_id, network, code_verifier_enc, expires_at').maybeSingle();
      check(error, 'lecture de l’état de connexion');
      if (!data) return null;
      return { userId: data.user_id, orgId: data.org_id, network: data.network as NetworkId, codeVerifierEnc: data.code_verifier_enc, expiresAt: new Date(data.expires_at) } satisfies StoredState;
    },

    async savePending(r) {
      const { data, error } = await admin.from('oauth_pending_selections')
        .insert({ user_id: r.userId, org_id: r.orgId, network: r.network, payload_enc: r.payloadEnc, expires_at: r.expiresAt.toISOString() })
        .select('id').single();
      check(error, 'enregistrement de la sélection');
      return data!.id as string;
    },

    async getPending(id) {
      const { data, error } = await admin.from('oauth_pending_selections').select('id, user_id, org_id, network, payload_enc, expires_at').eq('id', id).maybeSingle();
      check(error, 'lecture de la sélection');
      if (!data) return null;
      return { id: data.id, userId: data.user_id, orgId: data.org_id, network: data.network as NetworkId, payloadEnc: data.payload_enc, expiresAt: new Date(data.expires_at) } satisfies PendingSelection;
    },

    async deletePending(id) {
      const { error } = await admin.from('oauth_pending_selections').delete().eq('id', id);
      check(error, 'suppression de la sélection');
    },

    async connectChannel(r: ChannelWrite) {
      const { data, error } = await admin.rpc('connect_integration', {
        p_org: r.orgId, p_provider: r.provider, p_internal_id: r.internalId, p_name: r.name, p_username: r.username, p_picture_url: r.pictureUrl,
        p_settings: r.settings, p_token_expires_at: r.tokenExpiresAt ? r.tokenExpiresAt.toISOString() : null,
        p_access_token_enc: r.accessTokenEnc, p_refresh_token_enc: r.refreshTokenEnc,
      });
      check(error, 'création du canal');
      return data as string;
    },

    async getChannelForDisconnect(orgId, integrationId): Promise<ChannelForDisconnect | null> {
      const { data, error } = await admin.from('integrations').select('id, provider, internal_id, settings').eq('id', integrationId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
      check(error, 'lecture du canal');
      if (!data) return null;
      const { data: s, error: sErr } = await admin.from('integration_secrets').select('access_token_enc, refresh_token_enc').eq('integration_id', integrationId).maybeSingle();
      check(sErr, 'lecture des jetons');
      return {
        id: data.id, network: data.provider as NetworkId, internalId: data.internal_id, settings: data.settings ?? {},
        accessTokenEnc: s?.access_token_enc ?? null, refreshTokenEnc: s?.refresh_token_enc ?? null,
      };
    },

    async hasOtherChannelOnPage(pageId, exceptIntegrationId) {
      const { data, error } = await admin.from('integrations').select('id').in('provider', ['facebook', 'instagram']).is('deleted_at', null)
        .filter('settings->>page_id', 'eq', pageId).neq('id', exceptIntegrationId).limit(1);
      check(error, 'recherche des canaux de la Page');
      return (data ?? []).length > 0;
    },

    async disconnectChannel(orgId, integrationId) {
      const { data, error } = await admin.rpc('disconnect_integration', { p_org: orgId, p_integration: integrationId });
      check(error, 'déconnexion du canal');
      return data === true;
    },
  };
}
