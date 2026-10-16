import { describe, expect, it, vi } from 'vitest';
import {
  checkState, codeChallenge, createState, familyForNetwork, missingEnv, OAUTH_FAMILIES, OAuthError, TokenRejectedError, TokenTransientError,
  type Env, type OAuthContext,
} from '../src/index.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = new Date('2026-10-16T10:00:00Z');
const ENV: Env = {
  META_APP_ID: 'meta-id', META_APP_SECRET: 'meta-secret',
  X_CLIENT_ID: 'x-id', X_CLIENT_SECRET: 'x-secret',
  LINKEDIN_CLIENT_ID: 'li-id', LINKEDIN_CLIENT_SECRET: 'li-secret',
  GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret',
  TIKTOK_CLIENT_KEY: 'tt-key', TIKTOK_CLIENT_SECRET: 'tt-secret',
};

type Reply = { status?: number; body?: unknown } | Error;
/** Réseau simulé : une réponse par motif d'URL (première correspondance), et trace des appels. */
function fakeNet(routes: Record<string, Reply | Reply[]>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? '') });
    const key = [...queues.keys()].find((k) => url.includes(k));
    if (!key) throw new Error(`appel réseau inattendu : ${url}`);
    const q = queues.get(key)!;
    const r = q.length > 1 ? q.shift()! : q[0]!;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  const ctx: OAuthContext = { env: ENV, fetch: fetchImpl as unknown as typeof fetch, now: () => NOW };
  return { ctx, calls, fetchImpl };
}
const form = (body: string) => Object.fromEntries(new URLSearchParams(body));

describe('state signé', () => {
  it('accepte un state émis par nous et renvoie un hachage stable', async () => {
    const { state, hash } = await createState(KEY);
    expect(await checkState(state, KEY)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(state).not.toContain(hash);
  });
  it('rejette un state modifié, signé avec une autre clé ou absurde', async () => {
    const { state } = await createState(KEY);
    const [nonce, sig] = state.split('.');
    expect(await checkState(`${nonce}x.${sig}`, KEY)).toBeNull();
    expect(await checkState(state, Buffer.alloc(32, 9).toString('base64'))).toBeNull();
    for (const bad of [null, undefined, '', 'abc', 'a.b.c', '.', 'a.!!!', 'x'.repeat(500)]) expect(await checkState(bad, KEY)).toBeNull();
  });
  it('deux states ne sont jamais égaux', async () => {
    expect((await createState(KEY)).state).not.toBe((await createState(KEY)).state);
  });
});

describe('PKCE', () => {
  it('suit le vecteur de test de la RFC 7636', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('registre', () => {
  it('associe chaque réseau à sa famille', () => {
    expect(familyForNetwork('facebook')?.id).toBe('meta');
    expect(familyForNetwork('instagram')?.id).toBe('meta');
    expect(familyForNetwork('youtube')?.id).toBe('google');
    expect(familyForNetwork('x')?.id).toBe('x');
    expect(familyForNetwork('mastodon')).toBeNull();
  });
  it('liste les variables manquantes', () => {
    expect(missingEnv(OAUTH_FAMILIES.x, {})).toEqual(['X_CLIENT_ID', 'X_CLIENT_SECRET']);
    expect(missingEnv(OAUTH_FAMILIES.x, { X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b' })).toEqual([]);
    expect(missingEnv(OAUTH_FAMILIES.meta, { META_APP_ID: 'a' })).toEqual(['META_APP_SECRET']);
  });
});

describe('X', () => {
  const x = OAUTH_FAMILIES.x;
  it('construit l’URL d’autorisation avec PKCE S256', () => {
    const { ctx } = fakeNet({});
    const u = new URL(x.authorizeUrl(ctx, { network: 'x', redirectUri: 'https://app.test/cb', state: 'S', codeChallenge: 'CH' }));
    expect(u.origin + u.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'x-id', redirect_uri: 'https://app.test/cb', state: 'S', code_challenge: 'CH', code_challenge_method: 'S256',
      scope: 'tweet.read tweet.write users.read offline.access',
    });
  });
  it('échange le code (Basic + code_verifier) et calcule l’expiration', async () => {
    const { ctx, calls } = fakeNet({ '/oauth2/token': { body: { access_token: 'AT', refresh_token: 'RT', expires_in: 7200 } } });
    const t = await x.exchangeCode(ctx, { redirectUri: 'https://app.test/cb', code: 'CODE', codeVerifier: 'VER' });
    expect(t).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: new Date(NOW.getTime() + 7200_000) });
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${btoa('x-id:x-secret')}`);
    expect(form(calls[0]!.body)).toMatchObject({ grant_type: 'authorization_code', code: 'CODE', code_verifier: 'VER', client_id: 'x-id' });
  });
  it('un refus devient une OAuthError sans corps brut', async () => {
    const { ctx } = fakeNet({ '/oauth2/token': { status: 400, body: { error: 'invalid_request', error_description: 'Value passed for the token was invalid.', secret_debug: 'LEAK' } } });
    const err = await x.exchangeCode(ctx, { redirectUri: 'r', code: 'c', codeVerifier: 'v' }).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.message).toContain('Value passed for the token was invalid.');
    expect(err.message).not.toContain('LEAK');
  });
  it('rafraîchit : le nouveau refresh token remplace l’ancien (usage unique)', async () => {
    const { ctx, calls } = fakeNet({ '/oauth2/token': { body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 7200 } } });
    const t = await x.refresh!(ctx, 'RT1');
    expect(t.refreshToken).toBe('RT2');
    expect(form(calls[0]!.body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT1' });
  });
  it('invalid_grant au rafraîchissement = refus définitif ; 503 = panne passagère ; coupure = passagère', async () => {
    await expect(x.refresh!(fakeNet({ '/oauth2/token': { status: 400, body: { error: 'invalid_grant' } } }).ctx, 'RT')).rejects.toBeInstanceOf(TokenRejectedError);
    await expect(x.refresh!(fakeNet({ '/oauth2/token': { status: 503 } }).ctx, 'RT')).rejects.toBeInstanceOf(TokenTransientError);
    await expect(x.refresh!(fakeNet({ '/oauth2/token': new Error('ECONNRESET') }).ctx, 'RT')).rejects.toBeInstanceOf(TokenTransientError);
  });
  it('lit le profil', async () => {
    const { ctx, calls } = fakeNet({ '/2/users/me': { body: { data: { id: '42', name: 'Maison Lune', username: 'maisonlune', profile_image_url: 'https://pbs/x.jpg' } } } });
    const tokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW };
    const [c] = await x.listChannels(ctx, { network: 'x', tokens });
    expect(c).toMatchObject({ network: 'x', internalId: '42', name: 'Maison Lune', username: '@maisonlune', pictureUrl: 'https://pbs/x.jpg' });
    expect(calls[0]!.headers.Authorization).toBe('Bearer AT');
  });
  it('révoque les deux jetons à la déconnexion', async () => {
    const { ctx, calls } = fakeNet({ '/oauth2/revoke': { body: { revoked: true } } });
    await x.onDisconnect!(ctx, { network: 'x', internalId: '42', settings: {}, accessToken: 'AT', refreshToken: 'RT', sharesPageWithOtherChannel: false });
    expect(calls.map((c) => form(c.body).token)).toEqual(['RT', 'AT']);
  });
});

describe('LinkedIn', () => {
  const li = OAUTH_FAMILIES.linkedin;
  it('autorise sans PKCE avec les scopes OpenID + publication', () => {
    const u = new URL(li.authorizeUrl(fakeNet({}).ctx, { network: 'linkedin', redirectUri: 'https://app.test/cb', state: 'S', codeChallenge: null }));
    expect(u.searchParams.get('scope')).toBe('openid profile w_member_social');
    expect(u.searchParams.has('code_challenge')).toBe(false);
  });
  it('échange, lit le profil OpenID et pose author_urn', async () => {
    const { ctx, calls } = fakeNet({
      '/accessToken': { body: { access_token: 'AT', expires_in: 5184000 } },
      '/v2/userinfo': { body: { sub: 'abc123', name: 'Eric S', picture: 'https://media/p.jpg' } },
    });
    const tokens = await li.exchangeCode(ctx, { redirectUri: 'r', code: 'c', codeVerifier: null });
    expect(tokens.refreshToken).toBeNull(); // pas de refresh token pour une application standard
    expect(tokens.expiresAt).toEqual(new Date(NOW.getTime() + 5184000_000));
    expect(form(calls[0]!.body)).toMatchObject({ client_id: 'li-id', client_secret: 'li-secret' });
    const [c] = await li.listChannels(ctx, { network: 'linkedin', tokens });
    expect(c).toMatchObject({ internalId: 'abc123', name: 'Eric S', settings: { author_urn: 'urn:li:person:abc123' } });
  });
  it('rafraîchit quand un refresh token existe', async () => {
    const { ctx } = fakeNet({ '/accessToken': { body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 5184000 } } });
    expect((await li.refresh!(ctx, 'RT')).accessToken).toBe('AT2');
  });
});

describe('Google / YouTube', () => {
  const g = OAUTH_FAMILIES.google;
  it('demande un accès hors ligne avec PKCE', () => {
    const u = new URL(g.authorizeUrl(fakeNet({}).ctx, { network: 'youtube', redirectUri: 'https://app.test/cb', state: 'S', codeChallenge: 'CH' }));
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });
  it('le rafraîchissement sans nouveau refresh token le laisse inchangé (null)', async () => {
    const { ctx } = fakeNet({ 'oauth2.googleapis.com/token': { body: { access_token: 'AT2', expires_in: 3599 } } });
    expect(await g.refresh!(ctx, 'RT')).toEqual({ accessToken: 'AT2', refreshToken: null, expiresAt: new Date(NOW.getTime() + 3599_000) });
  });
  it('liste la chaîne, ou signale l’absence de chaîne', async () => {
    const tokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW };
    const ok = fakeNet({ '/youtube/v3/channels': { body: { items: [{ id: 'UC1', snippet: { title: 'Ma chaîne', customUrl: '@machaine', thumbnails: { default: { url: 'https://yt/t.jpg' } } } }] } } });
    expect((await g.listChannels(ok.ctx, { network: 'youtube', tokens }))[0]).toMatchObject({ internalId: 'UC1', name: 'Ma chaîne', username: '@machaine', pictureUrl: 'https://yt/t.jpg' });
    const none = fakeNet({ '/youtube/v3/channels': { body: { items: [] } } });
    await expect(g.listChannels(none.ctx, { network: 'youtube', tokens })).rejects.toMatchObject({ code: 'no_account' });
  });
  it('révoque le refresh token', async () => {
    const { ctx, calls } = fakeNet({ '/revoke': {} });
    await g.onDisconnect!(ctx, { network: 'youtube', internalId: 'UC1', settings: {}, accessToken: 'AT', refreshToken: 'RT', sharesPageWithOtherChannel: false });
    expect(form(calls[0]!.body)).toEqual({ token: 'RT' });
  });
});

describe('TikTok', () => {
  const t = OAUTH_FAMILIES.tiktok;
  it('construit l’URL avec client_key et scopes séparés par des virgules', () => {
    const u = new URL(t.authorizeUrl(fakeNet({}).ctx, { network: 'tiktok', redirectUri: 'https://app.test/cb', state: 'S', codeChallenge: null }));
    expect(u.searchParams.get('client_key')).toBe('tt-key');
    expect(u.searchParams.get('scope')).toBe('user.info.basic,video.publish,video.upload');
  });
  it('traite une erreur renvoyée dans un corps 200 comme un refus', async () => {
    const { ctx } = fakeNet({ '/oauth/token': { status: 200, body: { error: 'invalid_grant', error_description: 'Refresh token is expired' } } });
    await expect(t.refresh!(ctx, 'RT')).rejects.toBeInstanceOf(TokenRejectedError);
  });
  it('le refresh token tourne', async () => {
    const { ctx, calls } = fakeNet({ '/oauth/token': { body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 86400, open_id: 'OID' } } });
    expect((await t.refresh!(ctx, 'RT1')).refreshToken).toBe('RT2');
    expect(form(calls[0]!.body)).toMatchObject({ client_key: 'tt-key', client_secret: 'tt-secret', grant_type: 'refresh_token' });
  });
  it('lit le profil', async () => {
    const { ctx } = fakeNet({ '/user/info': { body: { data: { user: { open_id: 'OID', display_name: 'Lune', avatar_url: 'https://tt/a.jpg' } } } } });
    expect((await t.listChannels(ctx, { network: 'tiktok', tokens: { accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW } }))[0]).toMatchObject({ internalId: 'OID', name: 'Lune' });
  });
});

describe('Meta', () => {
  const m = OAUTH_FAMILIES.meta;
  const tokens = { accessToken: 'LONG', refreshToken: null, expiresAt: NOW };
  const accounts = {
    data: [
      { id: 'P1', name: 'Page Un', username: 'pageun', access_token: 'PT1', picture: { data: { url: 'https://fb/p1.jpg' } }, instagram_business_account: { id: 'IG1', username: 'pageun_ig', name: 'Page Un IG', profile_picture_url: 'https://ig/1.jpg' } },
      { id: 'P2', name: 'Page Deux', access_token: 'PT2' },
      { id: 'P3', name: 'Sans droit' },
    ],
  };

  it('demande plus de permissions pour Instagram que pour Facebook', () => {
    const { ctx } = fakeNet({});
    const scope = (network: 'facebook' | 'instagram') =>
      new URL(m.authorizeUrl(ctx, { network, redirectUri: 'https://app.test/cb', state: 'S', codeChallenge: null })).searchParams.get('scope')!.split(',');
    expect(scope('facebook')).toContain('pages_messaging');
    expect(scope('facebook')).not.toContain('instagram_manage_messages');
    expect(scope('instagram')).toEqual(expect.arrayContaining(['pages_show_list', 'instagram_manage_messages', 'instagram_content_publish']));
  });

  it('échange le code puis obtient un jeton longue durée, sans mettre le secret dans l’URL', async () => {
    const { ctx, calls } = fakeNet({
      '/oauth/access_token': [{ body: { access_token: 'SHORT', expires_in: 3600 } }, { body: { access_token: 'LONG', expires_in: 5183944 } }],
    });
    const t = await m.exchangeCode(ctx, { redirectUri: 'https://app.test/cb', code: 'CODE', codeVerifier: null });
    expect(t.accessToken).toBe('LONG');
    expect(calls).toHaveLength(2);
    expect(form(calls[0]!.body)).toMatchObject({ code: 'CODE', client_id: 'meta-id', client_secret: 'meta-secret' });
    expect(form(calls[1]!.body)).toMatchObject({ grant_type: 'fb_exchange_token', fb_exchange_token: 'SHORT' });
    for (const c of calls) expect(c.url).not.toContain('meta-secret');
  });

  it('liste les Pages avec leur jeton de Page (sans expiration) et ignore celles sans droit', async () => {
    const { ctx, calls } = fakeNet({ '/me/accounts': { body: accounts } });
    const list = await m.listChannels(ctx, { network: 'facebook', tokens });
    expect(list.map((c) => [c.network, c.internalId])).toEqual([['facebook', 'P1'], ['facebook', 'P2']]);
    expect(list[0]).toMatchObject({ name: 'Page Un', username: 'pageun', pictureUrl: 'https://fb/p1.jpg', settings: { page_id: 'P1' }, tokens: { accessToken: 'PT1', expiresAt: null } });
    expect(calls[0]!.headers.Authorization).toBe('Bearer LONG');
    expect(calls[0]!.url).not.toContain('LONG');
  });

  it('pour Instagram, ne propose que les comptes pro liés, avec le jeton de leur Page', async () => {
    const { ctx } = fakeNet({ '/me/accounts': { body: accounts } });
    const list = await m.listChannels(ctx, { network: 'instagram', tokens });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ network: 'instagram', internalId: 'IG1', username: '@pageun_ig', settings: { page_id: 'P1', page_name: 'Page Un' }, tokens: { accessToken: 'PT1' } });
  });

  it('pagine avec le curseur sans jamais suivre paging.next (qui contient le jeton)', async () => {
    const { ctx, calls } = fakeNet({
      '/me/accounts': [
        { body: { data: [{ id: 'P1', name: 'Un', access_token: 'T1' }], paging: { cursors: { after: 'CUR1' }, next: 'https://graph.facebook.com/next?access_token=LEAK' } } },
        { body: { data: [{ id: 'P2', name: 'Deux', access_token: 'T2' }] } },
      ],
    });
    const list = await m.listChannels(ctx, { network: 'facebook', tokens });
    expect(list.map((c) => c.internalId)).toEqual(['P1', 'P2']);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain('after=CUR1');
    expect(calls.every((c) => !c.url.includes('LEAK'))).toBe(true);
  });

  it('explique l’absence de compte', async () => {
    const none = fakeNet({ '/me/accounts': { body: { data: [{ id: 'P2', name: 'Deux', access_token: 'PT2' }] } } });
    await expect(m.listChannels(none.ctx, { network: 'instagram', tokens })).rejects.toMatchObject({ code: 'no_account' });
    const empty = fakeNet({ '/me/accounts': { body: { data: [] } } });
    await expect(m.listChannels(empty.ctx, { network: 'facebook', tokens })).rejects.toMatchObject({ code: 'no_account' });
  });

  it('s’abonne aux webhooks de la Page avec le jeton de Page, et signale l’échec sans lever', async () => {
    const cand = { network: 'facebook' as const, internalId: 'P1', name: 'Un', username: null, pictureUrl: null, settings: { page_id: 'P1' }, tokens: { accessToken: 'PT1', refreshToken: null, expiresAt: null } };
    const ok = fakeNet({ '/P1/subscribed_apps': { body: { success: true } } });
    expect(await m.afterConnect!(ok.ctx, cand)).toEqual({ ok: true });
    expect(ok.calls[0]).toMatchObject({ method: 'POST' });
    expect(ok.calls[0]!.headers.Authorization).toBe('Bearer PT1');
    expect(form(ok.calls[0]!.body).subscribed_fields).toBe('messages,messaging_postbacks,feed');

    const denied = fakeNet({ '/P1/subscribed_apps': { status: 400, body: { error: { message: '(#200) permission manquante' } } } });
    expect(await m.afterConnect!(denied.ctx, cand)).toMatchObject({ ok: false, error: expect.stringContaining('permission manquante') });
    const down = fakeNet({ '/P1/subscribed_apps': new Error('boom') });
    expect((await m.afterConnect!(down.ctx, cand)).ok).toBe(false);
  });

  it('se désabonne de la Page sauf si un autre canal l’utilise encore', async () => {
    const info = { network: 'facebook' as const, internalId: 'P1', settings: { page_id: 'P1' }, accessToken: 'PT1', refreshToken: null };
    const a = fakeNet({ '/P1/subscribed_apps': { body: { success: true } } });
    await m.onDisconnect!(a.ctx, { ...info, sharesPageWithOtherChannel: false });
    expect(a.calls[0]).toMatchObject({ method: 'DELETE' });
    const b = fakeNet({});
    await m.onDisconnect!(b.ctx, { ...info, sharesPageWithOtherChannel: true });
    expect(b.calls).toHaveLength(0);
  });
});
