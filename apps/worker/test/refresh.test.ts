import { describe, expect, it, vi } from 'vitest';
import { refreshTokens, type RefreshDb, type RefreshJob } from '../src/engine/refresh.ts';
import { ReconnectRequiredError, RefreshTransientError } from '../src/providers/errors.ts';
import { createLinkedInProvider } from '../src/providers/linkedin.ts';
import { createRegistry, type ProviderRegistry } from '../src/providers/registry.ts';
import { createTikTokProvider } from '../src/providers/tiktok.ts';
import type { SocialProvider } from '../src/providers/types.ts';
import { createXProvider } from '../src/providers/x.ts';
import { createYouTubeProvider } from '../src/providers/youtube.ts';

const ENV = { X_CLIENT_ID: 'x-id', X_CLIENT_SECRET: 'x-secret', LINKEDIN_CLIENT_ID: 'li', LINKEDIN_CLIENT_SECRET: 'lis', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs', TIKTOK_CLIENT_KEY: 'tk', TIKTOK_CLIENT_SECRET: 'tks' };

const job = (o: Partial<RefreshJob> = {}): RefreshJob => ({ id: 'int-1', orgId: 'org-1', provider: 'x', name: 'Maison Lune', internalId: '42', settings: {}, refreshToken: 'RT1', ...o });

function fakeRefreshDb(jobs: RefreshJob[] = [], o: Partial<RefreshDb> = {}) {
  const db: RefreshDb = {
    claim: vi.fn(async () => jobs),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => {}),
    expireUnrefreshable: vi.fn(async () => []),
    notifyAdmins: vi.fn(async () => {}),
    purgeExpiredOAuth: vi.fn(async () => {}),
    ...o,
  };
  return db;
}

const provider = (refreshToken: SocialProvider['refreshToken']): SocialProvider => ({ id: 'x', supportsThreads: false, supportsMedia: false, publish: async () => [], refreshToken });
const registry = (p: SocialProvider): ProviderRegistry => (id) => (['x', 'linkedin', 'youtube', 'tiktok'].includes(id) ? p : null);
const NEW = { accessToken: 'AT2', refreshToken: 'RT2', expiresAt: new Date('2026-10-16T12:00:00Z') };

describe('refreshTokens', () => {
  it('rafraîchit et enregistre les nouveaux jetons (le nouveau refresh token remplace l’ancien)', async () => {
    const db = fakeRefreshDb([job()]);
    const refresh = vi.fn(async () => NEW);
    const stats = await refreshTokens({ db, providers: registry(provider(refresh)) });
    expect(refresh).toHaveBeenCalledWith({ refreshToken: 'RT1', integration: { id: 'int-1', internalId: '42', settings: {} } });
    expect(db.complete).toHaveBeenCalledWith('int-1', NEW);
    expect(stats).toMatchObject({ refreshed: 1, reconnectNeeded: 0, transientFailures: 0 });
    expect(db.fail).not.toHaveBeenCalled();
  });

  it('ne réclame que les réseaux capables de rafraîchir', async () => {
    const db = fakeRefreshDb([]);
    await refreshTokens({ db, providers: createRegistry({ dryRun: false, env: ENV }) });
    expect((db.claim as any).mock.calls[0][0].sort()).toEqual(['linkedin', 'tiktok', 'x', 'youtube']);
    const none = fakeRefreshDb([]);
    await refreshTokens({ db: none, providers: createRegistry({ dryRun: true }) });
    expect(none.claim).not.toHaveBeenCalled(); // mode essai : aucun réseau contacté
  });

  it('refus définitif : canal à reconnecter + notification aux administrateurs', async () => {
    const db = fakeRefreshDb([job()]);
    const stats = await refreshTokens({ db, providers: registry(provider(async () => { throw new ReconnectRequiredError('invalid_grant'); })) });
    expect(db.fail).toHaveBeenCalledWith('int-1', true);
    expect(db.complete).not.toHaveBeenCalled();
    expect(db.notifyAdmins).toHaveBeenCalledWith('org-1', expect.objectContaining({ type: 'channel_reconnect', body: expect.stringContaining('Maison Lune') }));
    expect(stats.reconnectNeeded).toBe(1);
  });

  it('panne passagère : rien n’est modifié (le verrou expirera), pas de notification', async () => {
    const db = fakeRefreshDb([job()]);
    const stats = await refreshTokens({ db, providers: registry(provider(async () => { throw new RefreshTransientError('503'); })) });
    expect(db.fail).not.toHaveBeenCalled();
    expect(db.notifyAdmins).not.toHaveBeenCalled();
    expect(stats.transientFailures).toBe(1);
  });

  it('une erreur imprévue est traitée comme passagère, jamais comme une déconnexion', async () => {
    const db = fakeRefreshDb([job()]);
    const stats = await refreshTokens({ db, providers: registry(provider(async () => { throw new TypeError('bug'); })) });
    expect(db.fail).not.toHaveBeenCalled();
    expect(stats.transientFailures).toBe(1);
  });

  it('un échec sur un canal n’empêche pas les autres', async () => {
    const db = fakeRefreshDb([job({ id: 'a' }), job({ id: 'b' })]);
    const refresh = vi.fn().mockRejectedValueOnce(new RefreshTransientError('x')).mockResolvedValueOnce(NEW);
    const stats = await refreshTokens({ db, providers: registry(provider(refresh)) });
    expect(db.complete).toHaveBeenCalledWith('b', NEW);
    expect(stats).toMatchObject({ refreshed: 1, transientFailures: 1 });
  });

  it('un refresh token illisible (clé de chiffrement changée) demande une reconnexion', async () => {
    const db = fakeRefreshDb([job({ refreshToken: null })]);
    const refresh = vi.fn();
    await refreshTokens({ db, providers: registry(provider(refresh)) });
    expect(refresh).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith('int-1', true);
  });

  it('un canal déconnecté pendant le rafraîchissement n’est pas ressuscité', async () => {
    const db = fakeRefreshDb([job()], { complete: vi.fn(async () => false) });
    const stats = await refreshTokens({ db, providers: registry(provider(async () => NEW)) });
    expect(stats.refreshed).toBe(0);
    expect(db.fail).not.toHaveBeenCalled();
  });

  it('les jetons échus sans refresh token possible déclenchent une notification', async () => {
    const db = fakeRefreshDb([], { expireUnrefreshable: vi.fn(async () => [{ id: 'li-1', orgId: 'org-1', provider: 'linkedin', name: 'Eric S' }]) });
    const stats = await refreshTokens({ db, providers: registry(provider(async () => NEW)) });
    expect(stats.expired).toBe(1);
    expect(db.notifyAdmins).toHaveBeenCalledWith('org-1', expect.objectContaining({ body: expect.stringContaining('Eric S') }));
  });

  it('une erreur de notification ou de base ne casse pas le passage', async () => {
    const db = fakeRefreshDb([job()], { notifyAdmins: vi.fn(async () => { throw new Error('db'); }), fail: vi.fn(async () => { throw new Error('db'); }) });
    await expect(refreshTokens({ db, providers: registry(provider(async () => { throw new ReconnectRequiredError(); })) })).resolves.toBeDefined();
  });
});

describe('refreshToken des fournisseurs (réseau simulé)', () => {
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const input = { refreshToken: 'RT', integration: { id: 'i', internalId: 'a', settings: {} } };

  it('X : échange le refresh token', async () => {
    const f = respond(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 7200 });
    const t = await createXProvider(f, ENV).refreshToken!(input);
    expect(t).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT2' });
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 7000_000);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe('https://api.x.com/2/oauth2/token');
    expect(new URLSearchParams(init.body).get('refresh_token')).toBe('RT');
  });

  it('LinkedIn, YouTube, TikTok : même contrat', async () => {
    expect(await createLinkedInProvider(respond(200, { access_token: 'A', expires_in: 100 }), ENV).refreshToken!(input)).toMatchObject({ accessToken: 'A', refreshToken: null });
    expect(await createYouTubeProvider(respond(200, { access_token: 'A', expires_in: 3599 }), ENV).refreshToken!(input)).toMatchObject({ accessToken: 'A', refreshToken: null });
    expect(await createTikTokProvider(respond(200, { access_token: 'A', refresh_token: 'R2', expires_in: 86400 }), ENV).refreshToken!(input)).toMatchObject({ refreshToken: 'R2' });
  });

  it('invalid_grant → reconnexion ; 500 ou coupure → passager', async () => {
    await expect(createXProvider(respond(400, { error: 'invalid_grant' }), ENV).refreshToken!(input)).rejects.toBeInstanceOf(ReconnectRequiredError);
    await expect(createXProvider(respond(503, {}), ENV).refreshToken!(input)).rejects.toBeInstanceOf(RefreshTransientError);
    const down = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(createXProvider(down, ENV).refreshToken!(input)).rejects.toBeInstanceOf(RefreshTransientError);
  });

  it('TikTok : une erreur dans un corps 200 est un refus', async () => {
    await expect(createTikTokProvider(respond(200, { error: 'invalid_grant', error_description: 'expired' }), ENV).refreshToken!(input)).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('une variable manquante sur le worker n’est PAS une déconnexion du compte', async () => {
    const f = respond(200, {});
    const err = await createXProvider(f, {}).refreshToken!(input).catch((e) => e);
    expect(err).toBeInstanceOf(RefreshTransientError);
    expect(err.message).toContain('X_CLIENT_ID');
    expect(f).not.toHaveBeenCalled();
  });
});
