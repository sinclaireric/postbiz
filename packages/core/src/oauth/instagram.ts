import { DEFAULT_GRAPH_VERSION } from '../../../../supabase/functions/_shared/meta/graph.ts';
import { ensureOk, requestJson, requireEnv } from './http.ts';
import { OAuthError, TokenRejectedError, TokenTransientError, type OAuthContext, type OAuthFamily, type TokenSet } from './types.ts';

// Instagram Login (« Instagram API with Instagram Login ») : on se connecte directement avec un compte Instagram professionnel, sans Page Facebook.
// Application distincte de l'application Meta : identifiants INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (cas d'utilisation « Gérer les messages et les
// contenus sur Instagram », rubrique « Configuration de l'API avec la connexion Instagram »). Pas de PKCE.
// Jeton : court (1 h) → échangé contre un jeton longue durée (60 jours) qui se prolonge de lui-même (≥ 24 h après sa création, avant son expiration) :
// il n'y a pas de refresh token, donc le jeton longue durée est AUSSI enregistré comme « refresh token » pour que le worker le prolonge.
// Le compte est enregistré comme un canal `instagram` (settings.login = 'instagram') : inbox et envoi de messages passent par graph.instagram.com.
// ⚠️ Non validé contre l'API réelle.
const AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const SHORT_TOKEN = 'https://api.instagram.com/oauth/access_token';
const GRAPH_HOST = 'graph.instagram.com';
const GRAPH = `https://${GRAPH_HOST}`;
// Pas de instagram_business_content_publish : la publication n'existe pas encore, et une permission absente de l'application fait refuser la connexion.
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];
const KEYS = ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'] as const;
/** Champs auxquels le compte s'abonne (webhooks). */
export const INSTAGRAM_LOGIN_SUBSCRIBED_FIELDS = ['messages', 'comments', 'messaging_postbacks'] as const;

function longLived(json: any, now: Date): TokenSet {
  const accessToken = json?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') throw new TokenRejectedError('Instagram n’a pas renvoyé de jeton d’accès.');
  const expiresIn = Number(json?.expires_in);
  return { accessToken, refreshToken: accessToken, expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null };
}

async function shortLivedToken(ctx: OAuthContext, redirectUri: string, code: string): Promise<string> {
  const e = requireEnv(ctx.env, KEYS);
  const res = await requestJson(ctx, SHORT_TOKEN, {
    form: { client_id: e.INSTAGRAM_APP_ID!, client_secret: e.INSTAGRAM_APP_SECRET!, grant_type: 'authorization_code', redirect_uri: redirectUri, code },
  });
  ensureOk(res);
  // Deux formes de réponse selon les versions : à plat, ou dans `data[0]`.
  const token = res.json?.access_token ?? res.json?.data?.[0]?.access_token;
  if (typeof token !== 'string' || token === '') throw new TokenRejectedError('Instagram n’a pas renvoyé de jeton d’accès.');
  return token;
}

export const instagramLoginFamily: OAuthFamily = {
  id: 'instagram_login',
  networks: ['instagram_standalone'],
  envKeys: KEYS,
  usesPkce: false,
  choose: false,

  authorizeUrl(ctx, a) {
    const p = new URLSearchParams({
      client_id: requireEnv(ctx.env, KEYS).INSTAGRAM_APP_ID!, redirect_uri: a.redirectUri, response_type: 'code', scope: SCOPES.join(','), state: a.state,
    });
    return `${AUTHORIZE}?${p}`;
  },

  async exchangeCode(ctx, a) {
    try {
      const short = await shortLivedToken(ctx, a.redirectUri, a.code);
      const e = requireEnv(ctx.env, KEYS);
      const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: e.INSTAGRAM_APP_SECRET!, access_token: short });
      const res = await requestJson(ctx, `${GRAPH}/access_token?${q}`);
      ensureOk(res);
      return longLived(res.json, ctx.now());
    } catch (e) {
      if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`Instagram a refusé la connexion : ${e.message}`, 'exchange');
      throw e;
    }
  },

  /** Prolonge le jeton longue durée : ici « refreshToken » est le jeton lui-même (voir plus haut). */
  async refresh(ctx, refreshToken) {
    const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: refreshToken });
    const res = await requestJson(ctx, `${GRAPH}/refresh_access_token?${q}`);
    ensureOk(res);
    return longLived(res.json, ctx.now());
  },

  async listChannels(ctx, { tokens }) {
    const q = new URLSearchParams({ fields: 'user_id,username,name,account_type,profile_picture_url' });
    const res = await requestJson(ctx, `${GRAPH}/${DEFAULT_GRAPH_VERSION}/me?${q}`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }).catch((e: Error) => {
      throw new OAuthError(`Profil Instagram illisible : ${e.message}`, 'profile');
    });
    const u = res.json;
    const id = u?.user_id ?? u?.id;
    if (!res.ok || !id) throw new OAuthError('Instagram n’a pas renvoyé le profil du compte.', 'profile');
    const username = u.username ? String(u.username) : null;
    return [{
      network: 'instagram', internalId: String(id), name: String(u.name || username || id), username: username ? `@${username}` : null,
      pictureUrl: typeof u.profile_picture_url === 'string' ? u.profile_picture_url : null,
      settings: { login: 'instagram', graph_host: GRAPH_HOST, ig_user_id: String(id) }, tokens,
    }];
  },

  async afterConnect(ctx, c) {
    try {
      const res = await requestJson(ctx, `${GRAPH}/${DEFAULT_GRAPH_VERSION}/${c.internalId}/subscribed_apps`, {
        method: 'POST', headers: { Authorization: `Bearer ${c.tokens.accessToken}` }, form: { subscribed_fields: INSTAGRAM_LOGIN_SUBSCRIBED_FIELDS.join(',') },
      });
      if (!res.ok || res.json?.success !== true) return { ok: false, error: `Abonnement aux webhooks refusé : ${(res.json?.error?.message ?? `réponse ${res.status}`).toString().slice(0, 200)}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Abonnement aux webhooks impossible : ${(e as Error).message}` };
    }
  },

  // Instagram n'a pas d'adresse de révocation : on se désabonne des webhooks, le jeton expirera de lui-même.
  async onDisconnect(ctx, d) {
    if (!d.accessToken) return;
    await requestJson(ctx, `${GRAPH}/${DEFAULT_GRAPH_VERSION}/${d.internalId}/subscribed_apps`, { method: 'DELETE', headers: { Authorization: `Bearer ${d.accessToken}` } });
  },
};
