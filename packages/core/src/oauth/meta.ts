import { DEFAULT_GRAPH_VERSION } from '../../../../supabase/functions/_shared/meta/graph.ts';
import { ensureOk, requestJson, requireEnv, toTokens } from './http.ts';
import { OAuthError, TokenRejectedError, TokenTransientError, type ChannelCandidate, type OAuthContext, type OAuthFamily, type TokenSet } from './types.ts';

// Meta (Facebook Login) : connexion de Pages Facebook et de comptes Instagram professionnels liés à une Page.
// Le jeton d'accès utilisateur (courte durée) est échangé contre un jeton longue durée (~60 jours) ; les jetons de
// Page obtenus avec lui n'expirent pas : c'est CE jeton de Page qui est enregistré pour chaque canal.
// Pas de PKCE (Meta ne le propose pas pour ce flux) : le `state` signé lié à l'utilisateur fait office de protection CSRF.
// ⚠️ Non validé contre l'API réelle ; les permissions avancées exigent la revue d'application Meta (docs/RESEAUX.md).
const GRAPH = `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}`;
const AUTHORIZE = `https://www.facebook.com/${DEFAULT_GRAPH_VERSION}/dialog/oauth`;
const KEYS = ['META_APP_ID', 'META_APP_SECRET'] as const;

const PAGE_SCOPES = ['pages_show_list', 'pages_manage_metadata', 'pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement', 'pages_messaging'];
const INSTAGRAM_SCOPES = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_messages', 'instagram_manage_comments'];
/**
 * Champs de la Page auxquels l'application s'abonne. L'abonnement REMPLACE la liste précédente : Facebook et Instagram
 * partagent la même Page, donc on envoie toujours l'union complète pour qu'une connexion n'en désabonne pas une autre.
 */
export const META_SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'feed'] as const;
const MAX_PAGES = 10;

const fields =
  'id,name,username,picture.type(large){url},access_token,instagram_business_account{id,username,name,profile_picture_url}';

async function exchange(ctx: OAuthContext, form: Record<string, string>): Promise<TokenSet> {
  const e = requireEnv(ctx.env, KEYS);
  // POST : le secret de l'application ne transite pas dans l'URL (journaux, historique).
  const res = await requestJson(ctx, `${GRAPH}/oauth/access_token`, { method: 'POST', form: { ...form, client_id: e.META_APP_ID!, client_secret: e.META_APP_SECRET! } });
  ensureOk(res);
  return toTokens(res.json, ctx.now());
}

export const metaFamily: OAuthFamily = {
  id: 'meta',
  networks: ['facebook', 'instagram'],
  envKeys: KEYS,
  usesPkce: false,
  choose: true,

  authorizeUrl(ctx, a) {
    const scopes = a.network === 'instagram' ? [...PAGE_SCOPES, ...INSTAGRAM_SCOPES] : PAGE_SCOPES;
    const p = new URLSearchParams({
      client_id: requireEnv(ctx.env, KEYS).META_APP_ID!, redirect_uri: a.redirectUri, state: a.state, response_type: 'code', scope: scopes.join(','),
    });
    return `${AUTHORIZE}?${p}`;
  },

  async exchangeCode(ctx, a) {
    try {
      const short = await exchange(ctx, { redirect_uri: a.redirectUri, code: a.code });
      return await exchange(ctx, { grant_type: 'fb_exchange_token', fb_exchange_token: short.accessToken });
    } catch (e) {
      if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`Meta a refusé la connexion : ${e.message}`, 'exchange');
      throw e;
    }
  },

  async listChannels(ctx, { network, tokens }) {
    const out: ChannelCandidate[] = [];
    let after: string | undefined;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ fields, limit: '100', ...(after ? { after } : {}) });
        const res = await requestJson(ctx, `${GRAPH}/me/accounts?${q}`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
        ensureOk(res);
        for (const p of (res.json?.data ?? []) as any[]) {
          if (!p?.id || !p.access_token) continue; // Page sans droit de gestion : inutilisable
          const pageToken: TokenSet = { accessToken: String(p.access_token), refreshToken: null, expiresAt: null };
          const pagePicture: string | null = p.picture?.data?.url ?? null;
          if (network === 'facebook') {
            out.push({
              network: 'facebook', internalId: String(p.id), name: String(p.name ?? p.id), username: p.username ? String(p.username) : null,
              pictureUrl: pagePicture, settings: { page_id: String(p.id) }, tokens: pageToken,
            });
          } else if (p.instagram_business_account?.id) {
            const ig = p.instagram_business_account;
            out.push({
              network: 'instagram', internalId: String(ig.id), name: String(ig.name ?? ig.username ?? ig.id), username: ig.username ? `@${ig.username}` : null,
              pictureUrl: ig.profile_picture_url ?? null, settings: { page_id: String(p.id), page_name: String(p.name ?? '') }, tokens: pageToken,
            });
          }
        }
        // On pagine avec le curseur, jamais avec `paging.next` : cette URL contient le jeton d'accès.
        after = res.json?.paging?.cursors?.after;
        if (!res.json?.paging?.next || !after) break;
      }
    } catch (e) {
      if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`Impossible de lister vos comptes Meta : ${e.message}`, 'profile');
      throw e;
    }
    if (out.length === 0) {
      throw new OAuthError(
        network === 'facebook'
          ? 'Aucune Page Facebook que vous administrez n’a été autorisée. Relancez la connexion et cochez au moins une Page.'
          : 'Aucun compte Instagram professionnel lié à une Page autorisée n’a été trouvé. Liez le compte à une Page Facebook, puis relancez la connexion.',
        'no_account'
      );
    }
    return out;
  },

  async afterConnect(ctx, c) {
    const pageId = String(c.settings.page_id ?? c.internalId);
    try {
      const res = await requestJson(ctx, `${GRAPH}/${pageId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.tokens.accessToken}` },
        form: { subscribed_fields: META_SUBSCRIBED_FIELDS.join(',') },
      });
      if (!res.ok || res.json?.success !== true) return { ok: false, error: `Abonnement aux webhooks refusé : ${(res.json?.error?.message ?? `réponse ${res.status}`).toString().slice(0, 200)}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Abonnement aux webhooks impossible : ${(e as Error).message}` };
    }
  },

  async onDisconnect(ctx, d) {
    if (d.sharesPageWithOtherChannel || !d.accessToken) return;
    const pageId = String(d.settings.page_id ?? d.internalId);
    await requestJson(ctx, `${GRAPH}/${pageId}/subscribed_apps`, { method: 'DELETE', headers: { Authorization: `Bearer ${d.accessToken}` } });
  },
};
