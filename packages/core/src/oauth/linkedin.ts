import { ensureOk, requestJson, requireEnv, toTokens } from './http.ts';
import { OAuthError, TokenRejectedError, TokenTransientError, type ChannelCandidate, type Env, type OAuthFamily, type OAuthContext, type TokenSet } from './types.ts';

// LinkedIn : OAuth 2.0 « 3-legged » (profil personnel via OpenID Connect + publication w_member_social).
// Pas de PKCE : LinkedIn ne le documente pas pour les applications web confidentielles.
// Les jetons durent ~60 jours ; un refresh token n'est émis que pour certains partenaires.
// Les Pages LinkedIn (organisation, réseau « linkedin_page ») sont une famille à part, avec leurs propres identifiants : la Community Management
// API qu'elles exigent doit être le SEUL produit de son application chez LinkedIn, donc il faut une seconde application (LINKEDIN_PAGE_*).
// ⚠️ Non validé contre l'API réelle.
const AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const REVOKE = 'https://www.linkedin.com/oauth/v2/revoke';
const USERINFO = 'https://api.linkedin.com/v2/userinfo';
const ORGANIZATION_ACLS = 'https://api.linkedin.com/rest/organizationAcls';
const ORGANIZATIONS = 'https://api.linkedin.com/rest/organizations';
const PROFILE_SCOPES = ['openid', 'profile', 'w_member_social'];
// rw_organization_admin : lister les Pages administrées ; w_organization_social : publier et commenter au nom de la Page.
// Pas d'openid/profile : l'application des Pages n'a que la Community Management API, sans « Sign In with LinkedIn ».
// r_organization_social : statistiques de la Page (impressions, interactions, abonnés), relevées chaque jour par le worker.
const PAGE_SCOPES = ['rw_organization_admin', 'w_organization_social', 'r_organization_social'];
const PROFILE_KEYS = ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'] as const;
const PAGE_KEYS = ['LINKEDIN_PAGE_CLIENT_ID', 'LINKEDIN_PAGE_CLIENT_SECRET'] as const;
type Keys = readonly [string, string];
const MAX_PAGES = 20;

/** Version de l'API LinkedIn (AAAAMM). LinkedIn retire les versions anciennes : à mettre à jour régulièrement. */
export const DEFAULT_LINKEDIN_API_VERSION = '202601';

/**
 * Une variable présente mais vide (ligne `LINKEDIN_API_VERSION=` laissée telle quelle dans le fichier d'environnement) vaut « non définie » :
 * sinon l'en-tête partirait vide et LinkedIn refuserait la requête. Une valeur qui n'est pas AAAAMM est ignorée de même.
 */
export function linkedInApiVersion(env: Env = {}): string {
  const value = (env.LINKEDIN_API_VERSION ?? '').trim();
  return /^\d{6}$/.test(value) ? value : DEFAULT_LINKEDIN_API_VERSION;
}

async function token(ctx: OAuthContext, keys: Keys, form: Record<string, string>): Promise<TokenSet> {
  const e = requireEnv(ctx.env, keys);
  const res = await requestJson(ctx, TOKEN, { form: { ...form, client_id: e[keys[0]]!, client_secret: e[keys[1]]! } });
  ensureOk(res);
  return toTokens(res.json, ctx.now());
}

/** Pages (organisations) que le membre administre : liste des droits, puis le détail de chaque Page. */
async function listPages(ctx: OAuthContext, tokens: TokenSet): Promise<ChannelCandidate[]> {
  const headers = {
    Authorization: `Bearer ${tokens.accessToken}`,
    'LinkedIn-Version': linkedInApiVersion(ctx.env),
    'X-Restli-Protocol-Version': '2.0.0',
  };
  const ids: string[] = [];
  try {
    for (let start = 0; start < MAX_PAGES * 100 && ids.length < MAX_PAGES; start += 100) {
      const q = new URLSearchParams({ q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED', count: '100', start: String(start) });
      const res = await requestJson(ctx, `${ORGANIZATION_ACLS}?${q}`, { headers });
      ensureOk(res);
      const elements = (res.json?.elements ?? []) as any[];
      for (const el of elements) {
        const id = /^urn:li:organization:(\d+)$/.exec(String(el?.organization ?? ''))?.[1];
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (elements.length < 100) break;
    }
  } catch (e) {
    if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`Impossible de lister vos Pages LinkedIn : ${e.message}`, 'profile');
    throw e;
  }

  const out: ChannelCandidate[] = [];
  for (const id of ids.slice(0, MAX_PAGES)) {
    let name = `Page ${id}`;
    let vanity: string | null = null;
    try {
      const res = await requestJson(ctx, `${ORGANIZATIONS}/${id}`, { headers });
      if (res.ok) {
        name = String(res.json?.localizedName ?? name);
        vanity = res.json?.vanityName ? String(res.json.vanityName) : null;
      }
    } catch {
      /* Le détail est facultatif : on garde la Page avec un nom de repli plutôt que de la perdre. */
    }
    out.push({
      network: 'linkedin_page', internalId: id, name, username: vanity, pictureUrl: null,
      settings: { author_urn: `urn:li:organization:${id}`, kind: 'page' }, tokens,
    });
  }
  if (out.length === 0) {
    throw new OAuthError('Aucune Page LinkedIn que vous administrez n’a été trouvée.', 'no_account');
  }
  return out;
}

function createFamily(o: { id: 'linkedin' | 'linkedin_page'; keys: Keys; scopes: string[]; choose: boolean }): OAuthFamily {
  const { keys } = o;
  return {
    id: o.id,
    networks: [o.id],
    envKeys: keys,
    usesPkce: false,
    choose: o.choose,

    authorizeUrl(ctx, a) {
      const p = new URLSearchParams({
        response_type: 'code', client_id: requireEnv(ctx.env, keys)[keys[0]]!, redirect_uri: a.redirectUri, state: a.state, scope: o.scopes.join(' '),
      });
      return `${AUTHORIZE}?${p}`;
    },

    async exchangeCode(ctx, a) {
      try {
        return await token(ctx, keys, { grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri });
      } catch (e) {
        if (e instanceof TokenRejectedError || e instanceof TokenTransientError) throw new OAuthError(`LinkedIn a refusé la connexion : ${e.message}`, 'exchange');
        throw e;
      }
    },

    refresh: (ctx, refreshToken) => token(ctx, keys, { grant_type: 'refresh_token', refresh_token: refreshToken }),

    async listChannels(ctx, { tokens }) {
      if (o.id === 'linkedin_page') return listPages(ctx, tokens);
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
      const e = requireEnv(ctx.env, keys);
      for (const value of [d.refreshToken, d.accessToken]) {
        if (value) await requestJson(ctx, REVOKE, { form: { token: value, client_id: e[keys[0]]!, client_secret: e[keys[1]]! } });
      }
    },
  };
}

/** Profil personnel : se connecte d'un coup. */
export const linkedinFamily = createFamily({ id: 'linkedin', keys: PROFILE_KEYS, scopes: PROFILE_SCOPES, choose: false });
/** Pages : seconde application LinkedIn ; l'utilisateur coche celles qu'il veut (il peut en administrer plusieurs). */
export const linkedinPageFamily = createFamily({ id: 'linkedin_page', keys: PAGE_KEYS, scopes: PAGE_SCOPES, choose: true });
