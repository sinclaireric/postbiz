import { describe, expect, it, vi } from 'vitest';
import { decryptSecret, type Env } from '@postbiz/core';
import {
  completeConnection, confirmSelection, disconnectChannel, getPendingSelection, startConnection,
  type ChannelForDisconnect, type ChannelWrite, type FlowDeps, type OAuthStore, type PendingSelection, type StoredState,
} from './flow';
import { networkAvailability } from './availability';

const KEY = Buffer.alloc(32, 3).toString('base64');
const ENV: Env = {
  META_APP_ID: 'meta-id', META_APP_SECRET: 'meta-secret', X_CLIENT_ID: 'x-id', X_CLIENT_SECRET: 'x-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'srv', TOKEN_ENCRYPTION_KEY: KEY,
};
const ORG = 'org-1';
const ALICE = 'user-alice';

class MemoryStore implements OAuthStore {
  states = new Map<string, StoredState>();
  pending = new Map<string, PendingSelection>();
  channels = new Map<string, ChannelWrite & { id: string; deleted: boolean }>();
  otherOnPage = false;
  async saveState(r: StoredState & { stateHash: string }) { this.states.set(r.stateHash, r); }
  async consumeState(h: string) { const r = this.states.get(h) ?? null; this.states.delete(h); return r; }
  async savePending(r: Omit<PendingSelection, 'id'>) { const id = `00000000-0000-4000-8000-${String(this.pending.size + 1).padStart(12, '0')}`; this.pending.set(id, { ...r, id }); return id; }
  async getPending(id: string) { return this.pending.get(id) ?? null; }
  async deletePending(id: string) { this.pending.delete(id); }
  async connectChannel(r: ChannelWrite) {
    const k = `${r.orgId}:${r.provider}:${r.internalId}`;
    const id = this.channels.get(k)?.id ?? `int-${this.channels.size + 1}`;
    this.channels.set(k, { ...r, id, deleted: false });
    return id;
  }
  async getChannelForDisconnect(orgId: string, id: string): Promise<ChannelForDisconnect | null> {
    const c = [...this.channels.values()].find((x) => x.id === id && x.orgId === orgId && !x.deleted);
    return c ? { id: c.id, network: c.provider, internalId: c.internalId, settings: c.settings, accessTokenEnc: c.accessTokenEnc, refreshTokenEnc: c.refreshTokenEnc } : null;
  }
  async hasOtherChannelOnPage() { return this.otherOnPage; }
  async disconnectChannel(orgId: string, id: string) {
    const c = [...this.channels.values()].find((x) => x.id === id && x.orgId === orgId && !x.deleted);
    if (!c) return false;
    c.deleted = true;
    c.accessTokenEnc = '';
    return true;
  }
}

type Reply = { status?: number; body?: unknown } | Error;
function setup(routes: Record<string, Reply | Reply[]> = {}, o: { admin?: boolean; env?: Env; now?: () => Date } = {}) {
  const store = new MemoryStore();
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
  const logs: string[] = [];
  const deps: FlowDeps = {
    store, env: o.env ?? ENV, fetch: fetchImpl as unknown as typeof fetch, siteUrl: 'https://app.test', encryptionKey: KEY,
    isAdmin: async () => o.admin ?? true, now: o.now, log: (m) => logs.push(m),
  };
  return { deps, store, calls, logs };
}

const stateFrom = (url: string) => new URL(url).searchParams.get('state')!;
const cb = (state: string, extra: Record<string, string> = { code: 'CODE' }) => new URLSearchParams({ state, ...extra });
const X_OK = {
  '/oauth2/token': { body: { access_token: 'X-ACCESS', refresh_token: 'X-REFRESH', expires_in: 7200 } },
  '/2/users/me': { body: { data: { id: '42', name: 'Maison Lune', username: 'maisonlune', profile_image_url: 'https://pbs/p.jpg' } } },
};
const META_OK = {
  '/oauth/access_token': [{ body: { access_token: 'SHORT' } }, { body: { access_token: 'LONG', expires_in: 5000000 } }],
  '/me/accounts': {
    body: {
      data: [
        { id: 'P1', name: 'Page Un', access_token: 'PAGE-TOKEN-1', instagram_business_account: { id: 'IG1', username: 'un_ig' } },
        { id: 'P2', name: 'Page Deux', access_token: 'PAGE-TOKEN-2' },
      ],
    },
  },
  '/subscribed_apps': { body: { success: true } },
};

describe('disponibilité des boutons', () => {
  it('rien en mode démo', () => {
    const a = networkAvailability(ENV, true);
    expect(Object.values(a).every((v) => !v.available)).toBe(true);
  });
  it('un réseau n’est actif que si ses clés ET la config de stockage des jetons sont là', () => {
    const a = networkAvailability(ENV, false);
    expect(a.x).toEqual({ available: true, missing: [] });
    expect(a.facebook!.available && a.instagram!.available).toBe(true);
    expect(a.linkedin).toEqual({ available: false, missing: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'] });
    expect(a.youtube!.missing).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    expect(a.tiktok!.missing).toEqual(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET']);
  });
  it('désactive tout sans clé de service ou avec une clé de chiffrement invalide', () => {
    expect(networkAvailability({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' }, false).x).toEqual({ available: false, missing: ['SUPABASE_SERVICE_ROLE_KEY'] });
    expect(networkAvailability({ ...ENV, TOKEN_ENCRYPTION_KEY: 'courte' }, false).x!.missing).toEqual(['TOKEN_ENCRYPTION_KEY']);
    expect(networkAvailability({ ...ENV, TOKEN_ENCRYPTION_KEY: undefined }, false).x!.available).toBe(false);
  });
});

describe('startConnection', () => {
  it('refuse un réseau inconnu, non configuré, ou un non-administrateur', async () => {
    expect(await startConnection(setup().deps, { network: 'mastodon', userId: ALICE, orgId: ORG })).toEqual({ ok: false, error: 'reseau_inconnu' });
    expect(await startConnection(setup().deps, { network: 'linkedin', userId: ALICE, orgId: ORG })).toEqual({ ok: false, error: 'non_configure' });
    expect(await startConnection(setup({}, { admin: false }).deps, { network: 'x', userId: ALICE, orgId: ORG })).toEqual({ ok: false, error: 'non_autorise' });
  });

  it('X : URL d’autorisation avec PKCE, état lié à l’utilisateur et à l’organisation, secrets chiffrés/hachés en base', async () => {
    const { deps, store } = setup();
    const r = await startConnection(deps, { network: 'x', userId: ALICE, orgId: ORG });
    if (!r.ok) throw new Error('attendu ok');
    const u = new URL(r.url);
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.test/api/oauth/callback/x');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const state = u.searchParams.get('state')!;
    const [hash, row] = [...store.states.entries()][0]!;
    expect(hash).not.toContain(state); // seul le hachage est conservé
    expect(row).toMatchObject({ userId: ALICE, orgId: ORG, network: 'x' });
    expect(row.codeVerifierEnc).toMatch(/^v1\./); // chiffré, jamais en clair
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('Meta : pas de PKCE, mais le réseau demandé détermine les permissions', async () => {
    const { deps, store } = setup();
    const r = await startConnection(deps, { network: 'instagram', userId: ALICE, orgId: ORG });
    if (!r.ok) throw new Error('attendu ok');
    expect(new URL(r.url).searchParams.get('scope')).toContain('instagram_manage_messages');
    expect(new URL(r.url).searchParams.has('code_challenge')).toBe(false);
    expect([...store.states.values()][0]).toMatchObject({ network: 'instagram', codeVerifierEnc: null });
  });
});

describe('completeConnection — réseau à compte unique (X)', () => {
  async function started(s = setup(X_OK)) {
    const r = await startConnection(s.deps, { network: 'x', userId: ALICE, orgId: ORG });
    if (!r.ok) throw new Error('attendu ok');
    return { ...s, state: stateFrom(r.url) };
  }

  it('connecte le canal et ne stocke que des jetons chiffrés', async () => {
    const { deps, store, calls, state } = await started();
    const r = await completeConnection(deps, { family: 'x', params: cb(state), userId: ALICE });
    expect(r).toEqual({ kind: 'connected', network: 'x', count: 1, webhookWarnings: 0 });
    const ch = [...store.channels.values()][0]!;
    expect(ch).toMatchObject({ orgId: ORG, provider: 'x', internalId: '42', name: 'Maison Lune', username: '@maisonlune', pictureUrl: 'https://pbs/p.jpg' });
    expect(ch.accessTokenEnc).not.toContain('X-ACCESS');
    expect(await decryptSecret(ch.accessTokenEnc, KEY)).toBe('X-ACCESS');
    expect(await decryptSecret(ch.refreshTokenEnc!, KEY)).toBe('X-REFRESH');
    expect(ch.tokenExpiresAt).toBeInstanceOf(Date);
    // le code_verifier envoyé au réseau est celui qui avait été chiffré au départ
    const form = new URLSearchParams(calls.find((c) => c.url.includes('/oauth2/token'))!.body);
    expect(form.get('code_verifier')).toHaveLength(43);
    expect(JSON.stringify([...store.channels.values()])).not.toMatch(/X-ACCESS|X-REFRESH/);
  });

  it('un state ne sert qu’une fois (rejeu refusé)', async () => {
    const { deps, state } = await started();
    expect((await completeConnection(deps, { family: 'x', params: cb(state), userId: ALICE })).kind).toBe('connected');
    expect(await completeConnection(deps, { family: 'x', params: cb(state), userId: ALICE })).toEqual({ kind: 'error', code: 'etat_invalide' });
  });

  it('refuse un state falsifié, absent ou émis pour un autre utilisateur, sans rien écrire', async () => {
    const { deps, store, state } = await started();
    expect(await completeConnection(deps, { family: 'x', params: cb(`${state}x`), userId: ALICE })).toEqual({ kind: 'error', code: 'etat_invalide' });
    expect(await completeConnection(deps, { family: 'x', params: new URLSearchParams({ code: 'CODE' }), userId: ALICE })).toEqual({ kind: 'error', code: 'etat_invalide' });
    // un autre utilisateur connecté qui rejoue le state de la victime est refusé
    expect(await completeConnection(deps, { family: 'x', params: cb(state), userId: 'user-mallory' })).toMatchObject({ kind: 'error', code: 'etat_invalide' });
    expect(store.channels.size).toBe(0);
  });

  it('refuse un state expiré ou présenté à la mauvaise famille', async () => {
    const late = await started();
    late.deps.now = () => new Date(Date.now() + 11 * 60_000);
    expect(await completeConnection(late.deps, { family: 'x', params: cb(late.state), userId: ALICE })).toMatchObject({ kind: 'error', code: 'etat_invalide' });
    const wrong = await started();
    expect(await completeConnection(wrong.deps, { family: 'linkedin', params: cb(wrong.state), userId: ALICE })).toMatchObject({ kind: 'error', code: 'etat_invalide' });
    expect(await completeConnection(wrong.deps, { family: 'inconnue', params: cb(wrong.state), userId: ALICE })).toEqual({ kind: 'error', code: 'reseau_inconnu' });
  });

  it('l’utilisateur annule chez le réseau : message neutre, état consommé', async () => {
    const { deps, store, state } = await started();
    const r = await completeConnection(deps, { family: 'x', params: cb(state, { error: 'access_denied', error_description: '<script>alert(1)</script>' }), userId: ALICE });
    expect(r).toEqual({ kind: 'error', code: 'refuse', network: 'x' });
    expect(store.states.size).toBe(0);
  });

  it('un administrateur rétrogradé entre-temps ne peut pas finir la connexion', async () => {
    const s = await started();
    s.deps.isAdmin = async () => false;
    expect(await completeConnection(s.deps, { family: 'x', params: cb(s.state), userId: ALICE })).toMatchObject({ kind: 'error', code: 'non_autorise' });
    expect(s.store.channels.size).toBe(0);
  });

  it('un échec du réseau devient un code fixe ; le détail reste dans les journaux, sans jeton', async () => {
    const s = await started(setup({ '/oauth2/token': { status: 400, body: { error: 'invalid_request', error_description: 'Code déjà utilisé' } } }));
    const r = await completeConnection(s.deps, { family: 'x', params: cb(s.state), userId: ALICE });
    expect(r).toEqual({ kind: 'error', code: 'echange', network: 'x' });
    expect(s.logs.join()).toContain('Code déjà utilisé');
    expect(s.logs.join()).not.toMatch(/x-secret|CODE/);
    expect(s.store.channels.size).toBe(0);
  });

  it('une panne réseau chez le réseau ne crée rien', async () => {
    const s = await started(setup({ '/oauth2/token': new Error('ECONNRESET') }));
    expect(await completeConnection(s.deps, { family: 'x', params: cb(s.state), userId: ALICE })).toMatchObject({ kind: 'error', code: 'echange' });
  });

  it('la reconnexion du même compte met à jour le canal au lieu d’en créer un second', async () => {
    const s = setup(X_OK);
    for (let i = 0; i < 2; i++) {
      const r = await startConnection(s.deps, { network: 'x', userId: ALICE, orgId: ORG });
      if (!r.ok) throw new Error();
      await completeConnection(s.deps, { family: 'x', params: cb(stateFrom(r.url)), userId: ALICE });
    }
    expect(s.store.channels.size).toBe(1);
  });
});

describe('completeConnection — Meta (choix des comptes)', () => {
  async function metaStart(network: 'facebook' | 'instagram', s = setup(META_OK)) {
    const r = await startConnection(s.deps, { network, userId: ALICE, orgId: ORG });
    if (!r.ok) throw new Error('attendu ok');
    const done = await completeConnection(s.deps, { family: 'meta', params: cb(stateFrom(r.url)), userId: ALICE });
    return { ...s, done };
  }

  it('liste les Pages et laisse choisir ; rien n’est créé tant que l’utilisateur n’a pas validé', async () => {
    const { store, done, calls } = await metaStart('facebook');
    expect(done.kind).toBe('select');
    expect(store.channels.size).toBe(0);
    expect(calls.some((c) => c.url.includes('subscribed_apps'))).toBe(false);
    const p = [...store.pending.values()][0]!;
    expect(p.payloadEnc).not.toMatch(/PAGE-TOKEN/); // jetons de Page chiffrés en base
  });

  it('ce que voit le navigateur ne contient aucun jeton', async () => {
    const { deps, done } = await metaStart('facebook');
    if (done.kind !== 'select') throw new Error();
    const view = await getPendingSelection(deps, { userId: ALICE, pendingId: done.pendingId });
    expect(view!.candidates.map((c) => [c.key, c.name])).toEqual([['facebook:P1', 'Page Un'], ['facebook:P2', 'Page Deux']]);
    expect(JSON.stringify(view)).not.toMatch(/PAGE-TOKEN|LONG|SHORT|meta-secret/);
    // un autre utilisateur ne peut pas la consulter
    expect(await getPendingSelection(deps, { userId: 'user-mallory', pendingId: done.pendingId })).toBeNull();
    expect(await getPendingSelection(deps, { userId: ALICE, pendingId: 'pas-un-uuid' })).toBeNull();
  });

  it('connecte seulement les comptes cochés, avec leur jeton de Page, et s’abonne aux webhooks de chaque Page', async () => {
    const { deps, store, calls, done } = await metaStart('facebook');
    if (done.kind !== 'select') throw new Error();
    const r = await confirmSelection(deps, { userId: ALICE, pendingId: done.pendingId, keys: ['facebook:P2', 'facebook:INCONNU'] });
    expect(r).toEqual({ kind: 'connected', network: 'facebook', count: 1, webhookWarnings: 0 });
    const ch = [...store.channels.values()];
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ provider: 'facebook', internalId: 'P2', name: 'Page Deux', settings: { page_id: 'P2' }, tokenExpiresAt: null });
    expect(await decryptSecret(ch[0]!.accessTokenEnc, KEY)).toBe('PAGE-TOKEN-2');
    expect(ch[0]!.refreshTokenEnc).toBeNull();
    const sub = calls.filter((c) => c.url.includes('/subscribed_apps'));
    expect(sub).toHaveLength(1);
    expect(sub[0]!.url).toContain('/P2/subscribed_apps');
    expect(sub[0]!.headers.Authorization).toBe('Bearer PAGE-TOKEN-2');
    expect(store.pending.size).toBe(0); // sélection consommée
  });

  it('Instagram : propose le compte pro lié et enregistre la Page associée', async () => {
    const { deps, store, done } = await metaStart('instagram');
    if (done.kind !== 'select') throw new Error();
    const view = await getPendingSelection(deps, { userId: ALICE, pendingId: done.pendingId });
    expect(view!.candidates.map((c) => c.key)).toEqual(['instagram:IG1']);
    await confirmSelection(deps, { userId: ALICE, pendingId: done.pendingId, keys: ['instagram:IG1'] });
    expect([...store.channels.values()][0]).toMatchObject({ provider: 'instagram', internalId: 'IG1', username: '@un_ig', settings: { page_id: 'P1' } });
  });

  it('aucune sélection → rien n’est connecté et la sélection reste disponible', async () => {
    const { deps, store, done } = await metaStart('facebook');
    if (done.kind !== 'select') throw new Error();
    expect(await confirmSelection(deps, { userId: ALICE, pendingId: done.pendingId, keys: [] })).toMatchObject({ kind: 'error', code: 'selection_vide' });
    expect(store.channels.size).toBe(0);
    expect(store.pending.size).toBe(1);
  });

  it('une sélection expirée ou d’un autre utilisateur est refusée', async () => {
    const { deps, store, done } = await metaStart('facebook');
    if (done.kind !== 'select') throw new Error();
    expect(await confirmSelection(deps, { userId: 'user-mallory', pendingId: done.pendingId, keys: ['facebook:P1'] })).toEqual({ kind: 'error', code: 'expire' });
    deps.now = () => new Date(Date.now() + 31 * 60_000);
    expect(await confirmSelection(deps, { userId: ALICE, pendingId: done.pendingId, keys: ['facebook:P1'] })).toEqual({ kind: 'error', code: 'expire' });
    expect(store.channels.size).toBe(0);
  });

  it('si l’abonnement aux webhooks échoue, le canal est créé mais l’utilisateur est prévenu', async () => {
    const s = setup({ ...META_OK, '/subscribed_apps': { status: 400, body: { error: { message: '(#200) manque pages_manage_metadata' } } } });
    const { deps, store, done, logs } = await metaStart('facebook', s);
    if (done.kind !== 'select') throw new Error();
    const r = await confirmSelection(deps, { userId: ALICE, pendingId: done.pendingId, keys: ['facebook:P1'] });
    expect(r).toEqual({ kind: 'connected', network: 'facebook', count: 1, webhookWarnings: 1 });
    expect(store.channels.size).toBe(1);
    expect(logs.join()).toContain('manque pages_manage_metadata');
  });

  it('aucun compte autorisé → message explicite, aucune sélection créée', async () => {
    const s = setup({ ...META_OK, '/me/accounts': { body: { data: [] } } });
    const { done, store } = await metaStart('facebook', s);
    expect(done).toEqual({ kind: 'error', code: 'aucun_compte', network: 'facebook' });
    expect(store.pending.size).toBe(0);
  });
});

describe('disconnectChannel', () => {
  async function connected(provider: 'x' | 'facebook') {
    const s = setup(provider === 'x' ? { ...X_OK, '/oauth2/revoke': { body: { revoked: true } } } : { ...META_OK, '/subscribed_apps': { body: { success: true } } });
    const r = await startConnection(s.deps, { network: provider, userId: ALICE, orgId: ORG });
    if (!r.ok) throw new Error();
    const done = await completeConnection(s.deps, { family: provider === 'x' ? 'x' : 'meta', params: cb(stateFrom(r.url)), userId: ALICE });
    if (done.kind === 'select') await confirmSelection(s.deps, { userId: ALICE, pendingId: done.pendingId, keys: ['facebook:P1'] });
    return { ...s, channel: [...s.store.channels.values()][0]! };
  }

  it('réservé aux administrateurs', async () => {
    const s = await connected('x');
    s.deps.isAdmin = async () => false;
    expect(await disconnectChannel(s.deps, { userId: ALICE, orgId: ORG, integrationId: s.channel.id })).toEqual({ ok: false, error: 'non_autorise' });
    expect(s.channel.deleted).toBe(false);
  });

  it('X : révoque les jetons chez le réseau (déchiffrés au dernier moment) puis supprime tout', async () => {
    const s = await connected('x');
    const r = await disconnectChannel(s.deps, { userId: ALICE, orgId: ORG, integrationId: s.channel.id });
    expect(r).toEqual({ ok: true, cleanupFailed: false });
    const revoked = s.calls.filter((c) => c.url.includes('/oauth2/revoke')).map((c) => new URLSearchParams(c.body).get('token'));
    expect(revoked).toEqual(['X-REFRESH', 'X-ACCESS']);
    expect(s.channel.deleted).toBe(true);
    expect(s.channel.accessTokenEnc).toBe('');
  });

  it('Meta : se désabonne de la Page, sauf si un autre canal (Instagram) l’utilise encore', async () => {
    const a = await connected('facebook');
    a.store.otherOnPage = true;
    await disconnectChannel(a.deps, { userId: ALICE, orgId: ORG, integrationId: a.channel.id });
    expect(a.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

    const b = await connected('facebook');
    await disconnectChannel(b.deps, { userId: ALICE, orgId: ORG, integrationId: b.channel.id });
    const del = b.calls.filter((c) => c.method === 'DELETE');
    expect(del).toHaveLength(1);
    expect(del[0]!.url).toContain('/P1/subscribed_apps');
  });

  it('un échec chez le réseau n’empêche pas la déconnexion locale', async () => {
    const s = await connected('x');
    const failing = setup({ '/oauth2/revoke': new Error('hors ligne') });
    s.deps.fetch = failing.deps.fetch;
    const r = await disconnectChannel(s.deps, { userId: ALICE, orgId: ORG, integrationId: s.channel.id });
    expect(r).toEqual({ ok: true, cleanupFailed: true });
    expect(s.channel.deleted).toBe(true);
  });

  it('un canal d’une autre organisation est introuvable', async () => {
    const s = await connected('x');
    expect(await disconnectChannel(s.deps, { userId: ALICE, orgId: 'org-autre', integrationId: s.channel.id })).toEqual({ ok: false, error: 'erreur' });
  });
});
