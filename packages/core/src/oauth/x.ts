import { basicAuth, ensureOk, requestJson, requireEnv, toTokens } from './http.ts';
import { OAuthError, TokenRejectedError, TokenTransientError, type OAuthFamily, type OAuthContext, type TokenSet } from './types.ts';

// X (Twitter) : OAuth 2.0 avec PKCE, application « confidentielle » (secret en authentification Basic).
// ⚠️ Non validé contre l'API réelle. Les refresh tokens de X sont À USAGE UNIQUE : toujours enregistrer le nouveau.
const AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const TOKEN = 'https://api.x.com/2/oauth2/token';
const REVOKE = 'https://api.x.com/2/oauth2/revoke';
const ME = 'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name';
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];
const KEYS = ['X_CLIENT_ID', 'X_CLIENT_SECRET'] as const;

const auth = (ctx: OAuthContext) => {
  const e = requireEnv(ctx.env, KEYS);
  return { id: e.X_CLIENT_ID!, headers: { Authorization: basicAuth(e.X_CLIENT_ID!, e.X_CLIENT_SECRET!) } };
};

async function token(ctx: OAuthContext, form: Record<string, string>): Promise<TokenSet> {
  const { id, headers } = auth(ctx);
  const res = await requestJson(ctx, TOKEN, { form: { ...form, client_id: id }, headers });
  ensureOk(res);
  return toTokens(res.json, ctx.now());
}

export const xFamily: OAuthFamily = {
  id: 'x',
  networks: ['x'],
  envKeys: KEYS,
  usesPkce: true,
  choose: false,

  authorizeUrl(ctx, a) {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: requireEnv(ctx.env, KEYS).X_CLIENT_ID!,
      redirect_uri: a.redirectUri,
      scope: SCOPES.join(' '),
      state: a.state,
      code_challenge: a.codeChallenge ?? '',
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZE}?${p}`;
  },

  async exchangeCode(ctx, a) {
    try {
      return await token(ctx, { grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri, code_verifier: a.codeVerifier ?? '' });
    } catch (e) {
      if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`X a refusé la connexion : ${e.message}`, 'exchange');
      throw e;
    }
  },

  refresh: (ctx, refreshToken) => token(ctx, { grant_type: 'refresh_token', refresh_token: refreshToken }),

  async listChannels(ctx, { tokens }) {
    const res = await requestJson(ctx, ME, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }).catch((e: Error) => {
      throw new OAuthError(`Profil X illisible : ${e.message}`, 'profile');
    });
    const u = res.json?.data;
    if (!res.ok || !u?.id) throw new OAuthError('X n’a pas renvoyé le profil du compte (l’accès à l’API X est payant : vérifiez votre offre).', 'profile');
    return [{
      network: 'x', internalId: String(u.id), name: String(u.name ?? u.username ?? u.id), username: u.username ? `@${u.username}` : null,
      pictureUrl: typeof u.profile_image_url === 'string' ? u.profile_image_url : null, settings: {}, tokens,
    }];
  },

  async onDisconnect(ctx, d) {
    const { id, headers } = auth(ctx);
    for (const [value, hint] of [[d.refreshToken, 'refresh_token'], [d.accessToken, 'access_token']] as const) {
      if (value) await requestJson(ctx, REVOKE, { form: { token: value, token_type_hint: hint, client_id: id }, headers });
    }
  },
};
