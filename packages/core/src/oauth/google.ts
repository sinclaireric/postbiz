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
// yt-analytics.readonly : statistiques de la chaîne (vues, interactions), relevées chaque jour par le worker (l'abonné compte vient de youtube.force-ssl).
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

async function token(ctx: OAuthContext, form: Record<string, string>): Promise<TokenSet> {
  const e = requireEnv(ctx.env, KEYS);
  const res = await requestJson(ctx, TOKEN, { form: { ...form, client_id: e.GOOGLE_CLIENT_ID!, client_secret: e.GOOGLE_CLIENT_SECRET! } });
  ensureOk(res);
  return toTokens(res.json, ctx.now());
}

/**
 * Pourquoi YouTube refuse-t-il de lire la chaîne ? La cause est dite à l'utilisateur et écrite dans le journal avec le code HTTP et la « raison » de Google
 * (jamais le corps de la réponse ni un jeton). Les deux causes courantes : l'API « YouTube Data API v3 » n'est pas activée dans le projet Google Cloud,
 * ou l'utilisateur a décoché une autorisation sur l'écran de Google (il peut les décocher une à une).
 */
export function channelReadFailure(status: number, json: any): OAuthError {
  const err = json?.error ?? {};
  const reason = String(err.errors?.[0]?.reason ?? '').slice(0, 60);
  const text = `${err.message ?? ''} ${reason}`.toLowerCase();
  const detail = `${status}${reason ? `, ${reason}` : ''}`;
  if (reason === 'accessNotConfigured' || /has not been used in project|is disabled/.test(text)) {
    return new OAuthError(`L’API YouTube Data v3 n’est pas activée dans le projet Google Cloud de l’application (${detail}).`, 'api_disabled');
  }
  if (/insufficientpermissions|insufficient authentication scopes|access_token_scope_insufficient/.test(text)) {
    return new OAuthError(`Une autorisation YouTube demandée n’a pas été accordée (${detail}).`, 'scope_missing');
  }
  return new OAuthError(`YouTube a refusé la lecture de la chaîne (${detail}).`, 'profile');
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
    if (!res.ok) throw channelReadFailure(res.status, res.json);
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
