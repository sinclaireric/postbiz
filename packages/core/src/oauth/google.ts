import { ensureOk, requestJson, requireEnv, toTokens } from './http.ts';
import { OAuthError, TokenRejectedError, TokenTransientError, type OAuthFamily, type OAuthContext, type TokenSet } from './types.ts';

// Google / YouTube : OAuth 2.0 avec PKCE. `access_type=offline` + `prompt=consent` pour obtenir un refresh token à
// chaque connexion. Les jetons d'accès durent 1 h. Un refresh token expire au bout de 7 jours tant que l'écran de
// consentement est en mode « Test » (voir docs/RESEAUX.md).
// ⚠️ Non validé contre l'API réelle.
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const CHANNELS = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

async function token(ctx: OAuthContext, form: Record<string, string>): Promise<TokenSet> {
  const e = requireEnv(ctx.env, KEYS);
  const res = await requestJson(ctx, TOKEN, { form: { ...form, client_id: e.GOOGLE_CLIENT_ID!, client_secret: e.GOOGLE_CLIENT_SECRET! } });
  ensureOk(res);
  return toTokens(res.json, ctx.now());
}

export const googleFamily: OAuthFamily = {
  id: 'google',
  networks: ['youtube'],
  envKeys: KEYS,
  usesPkce: true,
  choose: false,

  authorizeUrl(ctx, a) {
    const p = new URLSearchParams({
      client_id: requireEnv(ctx.env, KEYS).GOOGLE_CLIENT_ID!, redirect_uri: a.redirectUri, response_type: 'code', scope: SCOPES.join(' '),
      state: a.state, access_type: 'offline', prompt: 'consent', code_challenge: a.codeChallenge ?? '', code_challenge_method: 'S256',
    });
    return `${AUTHORIZE}?${p}`;
  },

  async exchangeCode(ctx, a) {
    try {
      return await token(ctx, { grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri, code_verifier: a.codeVerifier ?? '' });
    } catch (e) {
      if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`Google a refusé la connexion : ${e.message}`, 'exchange');
      throw e;
    }
  },

  refresh: (ctx, refreshToken) => token(ctx, { grant_type: 'refresh_token', refresh_token: refreshToken }),

  async listChannels(ctx, { tokens }) {
    const res = await requestJson(ctx, CHANNELS, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }).catch((e: Error) => {
      throw new OAuthError(`Chaîne YouTube illisible : ${e.message}`, 'profile');
    });
    if (!res.ok) throw new OAuthError('YouTube a refusé la lecture de la chaîne (API non activée ou autorisation insuffisante).', 'profile');
    const c = res.json?.items?.[0];
    if (!c?.id) throw new OAuthError('Ce compte Google n’a aucune chaîne YouTube.', 'no_account');
    const s = c.snippet ?? {};
    return [{
      network: 'youtube', internalId: String(c.id), name: String(s.title ?? c.id), username: typeof s.customUrl === 'string' ? s.customUrl : null,
      pictureUrl: s.thumbnails?.default?.url ?? null, settings: {}, tokens,
    }];
  },

  async onDisconnect(ctx, d) {
    const value = d.refreshToken ?? d.accessToken;
    if (value) await requestJson(ctx, REVOKE, { form: { token: value } });
  },
};
