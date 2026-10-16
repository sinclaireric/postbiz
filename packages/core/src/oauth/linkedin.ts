import { ensureOk, requestJson, requireEnv, toTokens } from './http.ts';
import { OAuthError, TokenRejectedError, TokenTransientError, type OAuthFamily, type OAuthContext, type TokenSet } from './types.ts';

// LinkedIn : OAuth 2.0 « 3-legged » (profil personnel via OpenID Connect + publication w_member_social).
// Pas de PKCE : LinkedIn ne le documente pas pour les applications web confidentielles.
// Les jetons durent ~60 jours ; un refresh token n'est émis que pour certains partenaires.
// Les Pages LinkedIn (organisation) exigent la Community Management API : pas encore gérées ici.
// ⚠️ Non validé contre l'API réelle.
const AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const REVOKE = 'https://www.linkedin.com/oauth/v2/revoke';
const USERINFO = 'https://api.linkedin.com/v2/userinfo';
const SCOPES = ['openid', 'profile', 'w_member_social'];
const KEYS = ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'] as const;

async function token(ctx: OAuthContext, form: Record<string, string>): Promise<TokenSet> {
  const e = requireEnv(ctx.env, KEYS);
  const res = await requestJson(ctx, TOKEN, { form: { ...form, client_id: e.LINKEDIN_CLIENT_ID!, client_secret: e.LINKEDIN_CLIENT_SECRET! } });
  ensureOk(res);
  return toTokens(res.json, ctx.now());
}

export const linkedinFamily: OAuthFamily = {
  id: 'linkedin',
  networks: ['linkedin'],
  envKeys: KEYS,
  usesPkce: false,
  choose: false,

  authorizeUrl(ctx, a) {
    const p = new URLSearchParams({
      response_type: 'code', client_id: requireEnv(ctx.env, KEYS).LINKEDIN_CLIENT_ID!, redirect_uri: a.redirectUri, state: a.state, scope: SCOPES.join(' '),
    });
    return `${AUTHORIZE}?${p}`;
  },

  async exchangeCode(ctx, a) {
    try {
      return await token(ctx, { grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri });
    } catch (e) {
      if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`LinkedIn a refusé la connexion : ${e.message}`, 'exchange');
      throw e;
    }
  },

  refresh: (ctx, refreshToken) => token(ctx, { grant_type: 'refresh_token', refresh_token: refreshToken }),

  async listChannels(ctx, { tokens }) {
    const res = await requestJson(ctx, USERINFO, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }).catch((e: Error) => {
      throw new OAuthError(`Profil LinkedIn illisible : ${e.message}`, 'profile');
    });
    const u = res.json;
    if (!res.ok || !u?.sub) throw new OAuthError('LinkedIn n’a pas renvoyé le profil du compte.', 'profile');
    const sub = String(u.sub);
    return [{
      network: 'linkedin', internalId: sub, name: String(u.name ?? [u.given_name, u.family_name].filter(Boolean).join(' ') ?? sub), username: null,
      pictureUrl: typeof u.picture === 'string' ? u.picture : null, settings: { author_urn: `urn:li:person:${sub}` }, tokens,
    }];
  },

  async onDisconnect(ctx, d) {
    const e = requireEnv(ctx.env, KEYS);
    for (const value of [d.refreshToken, d.accessToken]) {
      if (value) await requestJson(ctx, REVOKE, { form: { token: value, client_id: e.LINKEDIN_CLIENT_ID!, client_secret: e.LINKEDIN_CLIENT_SECRET! } });
    }
  },
};
