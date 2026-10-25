import { describe, expect, it, vi } from 'vitest';
import { processPost } from '../src/engine/posts.ts';
import { OutcomeUnknownError, PublishRejectedError, QuotaExceededError, ReconnectRequiredError } from '../src/providers/errors.ts';
import type { SocialProvider } from '../src/providers/types.ts';
import { fakeDb, integration, post } from './fakes.ts';

const provider = (publish: SocialProvider['publish'], o: Partial<SocialProvider> = {}): SocialProvider => ({
  id: 'facebook', supportsThreads: false, supportsMedia: false, publish: vi.fn(publish), ...o,
});
const registry = (p: SocialProvider | null) => () => p;

describe('processPost', () => {
  it('publie et enregistre l’identifiant du réseau', async () => {
    const db = fakeDb();
    const p = provider(async () => [{ releaseId: 'FB_1', releaseUrl: 'https://fb/1' }]);
    const out = await processPost({ db, providers: registry(p) }, post());
    expect(out.result).toBe('published');
    expect(db.markPublished).toHaveBeenCalledWith('post-1', { releaseId: 'FB_1', releaseUrl: 'https://fb/1' });
    expect(db.markPostFailed).not.toHaveBeenCalled();
    expect(p.publish).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'TOKEN', integration: expect.objectContaining({ internalId: 'PAGE1' }) }));
  });

  it('un refus du réseau donne « error » et prévient l’auteur', async () => {
    const db = fakeDb();
    const out = await processPost({ db, providers: registry(provider(async () => { throw new PublishRejectedError('Facebook a refusé : texte interdit', 400); })) }, post());
    expect(out.result).toBe('error');
    expect(db.markPostFailed).toHaveBeenCalledWith('post-1', 'error', expect.stringContaining('refusé'));
    expect(db.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', type: 'post_error' }));
  });

  it('quota épuisé : la publication est remise en file pour le renouvellement du quota, sans erreur', async () => {
    const db = fakeDb();
    const at = new Date('2026-10-25T07:10:00Z');
    const out = await processPost({ db, providers: registry(provider(async () => { throw new QuotaExceededError('Quota épuisé. Rien n’a été publié.', at, 403); })) }, post({ attempts: 1 }));
    expect(out.result).toBe('rescheduled');
    expect(db.reschedulePost).toHaveBeenCalledWith('post-1', at, expect.stringContaining('25/10/2026 07:10 UTC'));
    expect(db.markPostFailed).not.toHaveBeenCalled();
    expect(db.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', type: 'post_rescheduled', title: 'Publication reportée', data: expect.objectContaining({ publishAt: at.toISOString() }) }));
  });

  it('quota épuisé encore à la troisième tentative : la publication reste en erreur, l’utilisateur décide', async () => {
    const db = fakeDb();
    const out = await processPost({ db, providers: registry(provider(async () => { throw new QuotaExceededError('Quota épuisé.', new Date(), 403); })) }, post({ attempts: 3 }));
    expect(out.result).toBe('error');
    expect(db.reschedulePost).not.toHaveBeenCalled();
    expect(db.markPostFailed).toHaveBeenCalledWith('post-1', 'error', expect.stringContaining('reprogrammez'));
  });

  it('la deuxième tentative est encore reportée', async () => {
    const db = fakeDb();
    const out = await processPost({ db, providers: registry(provider(async () => { throw new QuotaExceededError('Quota épuisé.', new Date('2026-10-26T07:10:00Z'), 403); })) }, post({ attempts: 2 }));
    expect(out.result).toBe('rescheduled');
  });

  it('un accès expiré marque le canal « à reconnecter »', async () => {
    const db = fakeDb();
    const out = await processPost({ db, providers: registry(provider(async () => { throw new ReconnectRequiredError(); })) }, post());
    expect(out.result).toBe('error');
    expect(db.markIntegrationRefreshNeeded).toHaveBeenCalledWith('int-1');
  });

  it('une issue inconnue donne « unknown » et la publication n’est tentée qu’une seule fois', async () => {
    const db = fakeDb();
    const p = provider(async () => { throw new OutcomeUnknownError('délai dépassé'); });
    const out = await processPost({ db, providers: registry(p) }, post());
    expect(out.result).toBe('unknown');
    expect(p.publish).toHaveBeenCalledTimes(1);
    expect(db.markPostFailed).toHaveBeenCalledWith('post-1', 'unknown', expect.any(String));
    expect(db.markPublished).not.toHaveBeenCalled();
  });

  it('une exception inattendue du fournisseur donne « unknown », jamais « error »', async () => {
    const db = fakeDb();
    const out = await processPost({ db, providers: registry(provider(async () => { throw new TypeError('boom'); })) }, post());
    expect(out.result).toBe('unknown');
    expect(out.message).toMatch(/Vérifiez sur le réseau/);
  });

  it('si la base tombe pendant le traitement, le post passe en « unknown »', async () => {
    const db = fakeDb({ getIntegration: vi.fn(async () => { throw new Error('connexion perdue'); }) });
    const out = await processPost({ db, providers: registry(provider(async () => [])) }, post());
    expect(out.result).toBe('unknown');
    expect(db.markPostFailed).toHaveBeenCalledWith('post-1', 'unknown', expect.stringContaining('connexion perdue'));
  });

  it('si l’enregistrement échoue APRÈS une publication réussie, on signale « unknown » (la publication existe peut-être)', async () => {
    const db = fakeDb({ markPublished: vi.fn(async () => { throw new Error('écriture refusée'); }) });
    const p = provider(async () => [{ releaseId: 'FB_1', releaseUrl: null }]);
    const out = await processPost({ db, providers: registry(p) }, post());
    expect(out.result).toBe('unknown');
    expect(p.publish).toHaveBeenCalledTimes(1);
  });

  it('refuse sans appeler le réseau : canal inactif, introuvable, réseau non géré, jeton absent', async () => {
    const p = provider(async () => [{ releaseId: 'x', releaseUrl: null }]);

    let db = fakeDb({ getIntegration: vi.fn(async () => integration({ status: 'refresh_needed' })) });
    expect((await processPost({ db, providers: registry(p) }, post())).result).toBe('error');

    db = fakeDb({ getIntegration: vi.fn(async () => null) });
    expect((await processPost({ db, providers: registry(p) }, post())).result).toBe('error');

    db = fakeDb();
    const out = await processPost({ db, providers: registry(null) }, post());
    expect(out).toMatchObject({ result: 'error', message: expect.stringMatching(/pas encore disponible/) });

    db = fakeDb({ getAccessToken: vi.fn(async () => null) });
    expect((await processPost({ db, providers: registry(p) }, post())).result).toBe('error');
    expect(db.markIntegrationRefreshNeeded).toHaveBeenCalled();

    expect(p.publish).not.toHaveBeenCalled();
  });

  it('refuse un fil ou des médias quand le réseau ne les gère pas, sans publier', async () => {
    const p = provider(async () => [{ releaseId: 'x', releaseUrl: null }]);
    const withChild = fakeDb({ getChildren: vi.fn(async () => [post({ id: 'child' })]) });
    expect((await processPost({ db: withChild, providers: registry(p) }, post())).message).toMatch(/fils/);
    const withMedia = fakeDb();
    expect((await processPost({ db: withMedia, providers: registry(p) }, post({ media: [{ id: 'm' }] }))).message).toMatch(/médias/);
    expect(p.publish).not.toHaveBeenCalled();
  });

  it('transmet la publication racine puis les suites à un réseau qui gère les fils', async () => {
    const db = fakeDb({ getChildren: vi.fn(async () => [post({ id: 'child', content: 'suite' })]) });
    const p = provider(async ({ posts }) => posts.map((x) => ({ releaseId: x.id, releaseUrl: null })), { supportsThreads: true });
    const out = await processPost({ db, providers: registry(p) }, post());
    expect(out.result).toBe('published');
    expect((p.publish as any).mock.calls[0][0].posts.map((x: any) => x.id)).toEqual(['post-1', 'child']);
  });
});
