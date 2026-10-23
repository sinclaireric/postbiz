// Rafraîchissement des jetons des réseaux (X, LinkedIn, YouTube, TikTok). Les jetons de Page Meta n'expirent pas.
//
// Règles :
//  - un seul worker rafraîchit un jeton à la fois (verrou posé par claim_token_refresh), car les refresh tokens de
//    X et TikTok sont à usage unique / tournants ;
//  - refus définitif du réseau → canal « refresh_needed » + notification aux administrateurs ;
//  - panne passagère → on ne touche à rien, le verrou expire et on réessaie ;
//  - jeton expiré sans refresh token possible (LinkedIn standard) → « refresh_needed ».
import type { SupabaseClient } from '@supabase/supabase-js';
import { ReconnectRequiredError } from '../providers/errors.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

export interface RefreshJob {
  id: string;
  orgId: string;
  provider: string;
  name: string;
  internalId: string;
  settings: Record<string, unknown>;
  /** `null` : le refresh token enregistré est illisible (clé de chiffrement changée ?). */
  refreshToken: string | null;
}

export interface RefreshDb {
  claim(providers: string[], o: { withinSeconds: number; lockSeconds: number; limit: number }): Promise<RefreshJob[]>;
  complete(id: string, t: { accessToken: string; refreshToken: string | null; expiresAt: Date | null }): Promise<boolean>;
  fail(id: string, permanent: boolean): Promise<void>;
  expireUnrefreshable(): Promise<{ id: string; orgId: string; provider: string; name: string }[]>;
  notifyAdmins(orgId: string, n: { type: string; title: string; body: string; data?: Record<string, unknown> }): Promise<void>;
  purgeExpiredOAuth(): Promise<void>;
}

export interface RefreshStats { refreshed: number; reconnectNeeded: number; transientFailures: number; expired: number }

/** Jetons rafraîchis quand il leur reste moins de ce délai (les jetons X durent 2 h, Google 1 h). */
export const REFRESH_WITHIN_SECONDS = 30 * 60;
const LOCK_SECONDS = 5 * 60;
export const REFRESHABLE_PROVIDERS = ['x', 'linkedin', 'linkedin_page', 'instagram', 'youtube', 'tiktok'] as const;

export async function refreshTokens(
  deps: { db: RefreshDb; providers: ProviderRegistry },
  o: { limit?: number } = {},
  log: (msg: string, extra?: unknown) => void = () => {}
): Promise<RefreshStats> {
  const { db, providers } = deps;
  const stats: RefreshStats = { refreshed: 0, reconnectNeeded: 0, transientFailures: 0, expired: 0 };

  const reconnect = async (j: { id: string; orgId: string; provider: string; name: string }, reason: string) => {
    await db.fail(j.id, true);
    stats.reconnectNeeded++;
    await db
      .notifyAdmins(j.orgId, {
        type: 'channel_reconnect',
        title: 'Canal à reconnecter',
        body: `L’accès à « ${j.name} » (${j.provider}) n’est plus valide : ${reason} Reconnectez le canal depuis la page Canaux.`,
        data: { integrationId: j.id },
      })
      .catch((e) => log('notification impossible', (e as Error).message));
  };

  // 1. Jetons échus qu'aucun refresh token ne peut renouveler.
  for (const j of await db.expireUnrefreshable()) {
    stats.expired++;
    await db
      .notifyAdmins(j.orgId, {
        type: 'channel_reconnect',
        title: 'Canal à reconnecter',
        body: `L’accès à « ${j.name} » (${j.provider}) a expiré. Reconnectez le canal depuis la page Canaux.`,
        data: { integrationId: j.id },
      })
      .catch((e) => log('notification impossible', (e as Error).message));
  }

  // 2. Jetons qui expirent bientôt et ont un refresh token (seuls les réseaux capables de rafraîchir sont réclamés).
  const capable = REFRESHABLE_PROVIDERS.filter((id) => providers(id)?.refreshToken);
  if (capable.length === 0) return stats;
  const jobs = await db.claim(capable, { withinSeconds: REFRESH_WITHIN_SECONDS, lockSeconds: LOCK_SECONDS, limit: o.limit ?? 20 });

  for (const j of jobs) {
    let stage = 'auprès du réseau';
    try {
      if (!j.refreshToken) {
        await reconnect(j, 'le jeton de renouvellement enregistré est illisible.');
        continue;
      }
      const t = await providers(j.provider)!.refreshToken!({ refreshToken: j.refreshToken, integration: { id: j.id, internalId: j.internalId, settings: j.settings } });
      // Le réseau a peut-être déjà invalidé l'ancien refresh token : l'enregistrement du nouveau est l'étape critique.
      stage = 'enregistrement des nouveaux jetons';
      const saved = await db.complete(j.id, t);
      if (saved) {
        stats.refreshed++;
        log(`jeton rafraîchi : ${j.provider} ${j.id}`);
      } else {
        log(`canal déconnecté pendant le rafraîchissement : ${j.id}`);
      }
    } catch (e) {
      if (e instanceof ReconnectRequiredError) {
        log(`rafraîchissement refusé : ${j.provider} ${j.id}`, e.message);
        await reconnect(j, e.message).catch((err) => log('mise à jour du canal impossible', (err as Error).message));
      } else {
        stats.transientFailures++;
        // Le verrou (5 min) expirera et le prochain passage réessaiera ; rien n'est modifié ici.
        // Si l'échec survient à l'enregistrement, un refresh token à usage unique a pu être perdu : le prochain essai
        // sera alors refusé et le canal passera à « à reconnecter » (jamais de jeton en clair dans ce message).
        log(`rafraîchissement différé (${stage}) : ${j.provider} ${j.id}`, (e as Error).message);
      }
    }
  }

  await db.purgeExpiredOAuth().catch((e) => log('nettoyage OAuth impossible', (e as Error).message));
  return stats;
}

type Row = Record<string, any>;

export function createSupabaseRefreshDb(
  supabase: SupabaseClient,
  crypto: { encrypt: (plain: string) => Promise<string>; decrypt: (enc: string) => Promise<string> }
): RefreshDb {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what} : ${error.message}`);
  };
  return {
    async claim(providers, o) {
      const { data, error } = await supabase.rpc('claim_token_refresh', { p_providers: providers, p_within_seconds: o.withinSeconds, p_lock_seconds: o.lockSeconds, p_limit: o.limit });
      check(error, 'claim_token_refresh');
      return Promise.all(
        ((data ?? []) as Row[]).map(async (r) => ({
          id: r.id, orgId: r.org_id, provider: r.provider, name: r.name, internalId: r.internal_id, settings: r.settings ?? {},
          refreshToken: await crypto.decrypt(r.refresh_token_enc).catch(() => null),
        }))
      );
    },
    async complete(id, t) {
      const { data, error } = await supabase.rpc('complete_token_refresh', {
        p_integration: id,
        p_access_token_enc: await crypto.encrypt(t.accessToken),
        p_refresh_token_enc: t.refreshToken ? await crypto.encrypt(t.refreshToken) : null,
        p_expires_at: t.expiresAt ? t.expiresAt.toISOString() : null,
      });
      check(error, 'enregistrement du jeton rafraîchi');
      return data === true;
    },
    async fail(id, permanent) {
      const { error } = await supabase.rpc('fail_token_refresh', { p_integration: id, p_permanent: permanent });
      check(error, 'fail_token_refresh');
    },
    async expireUnrefreshable() {
      const { data, error } = await supabase.rpc('expire_unrefreshable_integrations');
      check(error, 'expire_unrefreshable_integrations');
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id, orgId: r.org_id, provider: r.provider, name: r.name }));
    },
    async notifyAdmins(orgId, n) {
      const { data, error } = await supabase.from('memberships').select('user_id').eq('org_id', orgId).eq('role', 'admin');
      check(error, 'lecture des administrateurs');
      const rows = ((data ?? []) as Row[]).map((m) => ({ user_id: m.user_id, org_id: orgId, type: n.type, title: n.title, body: n.body, data: n.data ?? {} }));
      if (rows.length === 0) return;
      const { error: insertError } = await supabase.from('notifications').insert(rows);
      check(insertError, 'création des notifications');
    },
    async purgeExpiredOAuth() {
      const { error } = await supabase.rpc('purge_expired_oauth');
      check(error, 'purge_expired_oauth');
    },
  };
}
