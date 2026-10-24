import { ensureOk, requestJson, requireEnv, toTokens } from './http.ts';
import { OAuthError, TokenRejectedError, TokenTransientError, type OAuthFamily, type OAuthContext, type TokenSet } from './types.ts';

// TikTok (Login Kit, v2). Le flux web documenté n'utilise pas PKCE (il est réservé aux applications bureau/mobiles).
// Jeton d'accès 24 h, refresh token ~365 jours, qui peut changer à chaque rafraîchissement : toujours enregistrer le nouveau.
// ⚠️ Non validé contre l'API réelle. Tant que l'audit TikTok n'est pas passé, les publications sont privées.
const AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const USER = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name';
// user.info.stats : nombre d'abonnés du compte, relevé chaque jour par le worker.
const SCOPES = ['user.info.basic', 'video.publish', 'video.upload', 'user.info.stats'];
const KEYS = ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'] as const;

async function token(ctx: OAuthContext, form: Record<string, string>): Promise<{ tokens: TokenSet; openId: string | null }> {
  const e = requireEnv(ctx.env, KEYS);
  const res = await requestJson(ctx, TOKEN, { form: { ...form, client_key: e.TIKTOK_CLIENT_KEY!, client_secret: e.TIKTOK_CLIENT_SECRET! } });
  ensureOk(res);
  return { tokens: toTokens(res.json, ctx.now()), openId: typeof res.json?.open_id === 'string' ? res.json.open_id : null };
}

export const tiktokFamily: OAuthFamily = {
  id: 'tiktok',
  networks: ['tiktok'],
  envKeys: KEYS,
  usesPkce: false,
  choose: false,

  authorizeUrl(ctx, a) {
    const p = new URLSearchParams({
      client_key: requireEnv(ctx.env, KEYS).TIKTOK_CLIENT_KEY!, scope: SCOPES.join(','), response_type: 'code', redirect_uri: a.redirectUri, state: a.state,
    });
    return `${AUTHORIZE}?${p}`;
  },

  async exchangeCode(ctx, a) {
    try {
      return (await token(ctx, { grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri })).tokens;
    } catch (e) {
      if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`TikTok a refusé la connexion : ${e.message}`, 'exchange');
      throw e;
    }
  },

  async refresh(ctx, refreshToken) {
    return (await token(ctx, { grant_type: 'refresh_token', refresh_token: refreshToken })).tokens;
  },

  async listChannels(ctx, { tokens }) {
    const res = await requestJson(ctx, USER, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }).catch((e: Error) => {
      throw new OAuthError(`Profil TikTok illisible : ${e.message}`, 'profile');
    });
    const u = res.json?.data?.user;
    if (!res.ok || !u?.open_id) throw new OAuthError('TikTok n’a pas renvoyé le profil du compte.', 'profile');
    return [{
      network: 'tiktok', internalId: String(u.open_id), name: String(u.display_name ?? u.open_id), username: null,
      pictureUrl: typeof u.avatar_url === 'string' ? u.avatar_url : null, settings: {}, tokens,
    }];
  },

  async onDisconnect(ctx, d) {
    const e = requireEnv(ctx.env, KEYS);
    const value = d.accessToken ?? d.refreshToken;
    if (value) await requestJson(ctx, REVOKE, { form: { client_key: e.TIKTOK_CLIENT_KEY!, client_secret: e.TIKTOK_CLIENT_SECRET!, token: value } });
  },
};
