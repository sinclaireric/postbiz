import { describe, expect, it, vi } from 'vitest';
import { processFirstComment } from '../src/engine/comments.ts';
import { OutcomeUnknownError, PublishRejectedError, ReconnectRequiredError } from '../src/providers/errors.ts';
import type { SocialProvider } from '../src/providers/types.ts';
import { fakeDb, integration, post } from './fakes.ts';

const provider = (comment: SocialProvider['comment'] | undefined, o: Partial<SocialProvider> = {}): SocialProvider => ({
  id: 'facebook', supportsThreads: false, supportsMedia: false, publish: vi.fn(), ...(comment ? { comment: vi.fn(comment) } : {}), ...o,
});
const registry = (p: SocialProvider | null) => () => p;
const withComment = (o: Parameters<typeof post>[0] = {}) => post({ releaseId: 'REL_1', firstComment: 'Merci de votre soutien', ...o });

describe('processFirstComment', () => {
  it('commente sous la publication et enregistre l’identifiant du commentaire', async () => {
    const db = fakeDb();
    const p = provider(async () => ({ commentId: 'C_1' }));
    const out = await processFirstComment({ db, providers: registry(p) }, withComment());
    expect(out.result).toBe('posted');
    expect(db.completeFirstComment).toHaveBeenCalledWith('post-1', 'C_1');
    expect(db.failFirstComment).not.toHaveBeenCalled();
    expect(p.comment).toHaveBeenCalledWith({ accessToken: 'TOKEN', integration: expect.objectContaining({ internalId: 'PAGE1' }), releaseId: 'REL_1', text: 'Merci de votre soutien' });
  });

  it('un refus du réseau donne « failed » (on peut réessayer) et prévient l’auteur', async () => {
    const db = fakeDb();
    const out = await processFirstComment({ db, providers: registry(provider(async () => { throw new PublishRejectedError('Facebook a refusé le commentaire : permission manquante', 403); })) }, withComment());
    expect(out.result).toBe('failed');
    expect(db.failFirstComment).toHaveBeenCalledWith('post-1', 'failed', expect.stringContaining('refusé le commentaire'));
    expect(db.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', type: 'comment_failed' }));
    expect(db.completeFirstComment).not.toHaveBeenCalled();
  });

  it('un accès expiré marque le canal « à reconnecter »', async () => {
    const db = fakeDb();
    const out = await processFirstComment({ db, providers: registry(provider(async () => { throw new ReconnectRequiredError(); })) }, withComment());
    expect(out.result).toBe('failed');
    expect(db.markIntegrationRefreshNeeded).toHaveBeenCalledWith('int-1');
  });

  it('une issue inconnue donne « unknown », et le commentaire n’est tenté qu’une seule fois', async () => {
    const db = fakeDb();
    const p = provider(async () => { throw new OutcomeUnknownError('délai dépassé'); });
    const out = await processFirstComment({ db, providers: registry(p) }, withComment());
    expect(out.result).toBe('unknown');
    expect(p.comment).toHaveBeenCalledTimes(1);
    expect(db.failFirstComment).toHaveBeenCalledWith('post-1', 'unknown', expect.any(String));
    expect(db.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'comment_unknown' }));
  });

  it('une exception inattendue du fournisseur donne « unknown », jamais « failed »', async () => {
    const db = fakeDb();
    const out = await processFirstComment({ db, providers: registry(provider(async () => { throw new TypeError('boom'); })) }, withComment());
    expect(out.result).toBe('unknown');
    expect(out.message).toMatch(/Vérifiez sous la publication/);
  });

  it('si l’enregistrement échoue APRÈS un commentaire réussi, on signale « unknown » (le commentaire existe peut-être)', async () => {
    const db = fakeDb({ completeFirstComment: vi.fn(async () => { throw new Error('écriture refusée'); }) });
    const p = provider(async () => ({ commentId: 'C_1' }));
    const out = await processFirstComment({ db, providers: registry(p) }, withComment());
    expect(out.result).toBe('unknown');
    expect(p.comment).toHaveBeenCalledTimes(1);
    expect(db.failFirstComment).toHaveBeenCalledWith('post-1', 'unknown', expect.stringContaining('écriture refusée'));
  });

  it('refuse sans appeler le réseau : texte vide, publication sans identifiant, canal inactif ou absent, réseau sans commentaire, jeton absent', async () => {
    const p = provider(async () => ({ commentId: 'x' }));

    for (const bad of [withComment({ firstComment: '   ' }), withComment({ firstComment: null }), withComment({ releaseId: null })]) {
      const db = fakeDb();
      expect((await processFirstComment({ db, providers: registry(p) }, bad)).result).toBe('failed');
      expect(db.failFirstComment).toHaveBeenCalledWith('post-1', 'failed', expect.any(String));
    }

    let db = fakeDb({ getIntegration: vi.fn(async () => integration({ status: 'refresh_needed' })) });
    expect((await processFirstComment({ db, providers: registry(p) }, withComment())).result).toBe('failed');

    db = fakeDb({ getIntegration: vi.fn(async () => null) });
    expect((await processFirstComment({ db, providers: registry(p) }, withComment())).result).toBe('failed');

    db = fakeDb();
    expect((await processFirstComment({ db, providers: registry(provider(undefined)) }, withComment())).result).toBe('failed');
    expect((await processFirstComment({ db, providers: registry(null) }, withComment())).result).toBe('failed');

    db = fakeDb({ getAccessToken: vi.fn(async () => null) });
    expect((await processFirstComment({ db, providers: registry(p) }, withComment())).result).toBe('failed');
    expect(db.markIntegrationRefreshNeeded).toHaveBeenCalledWith('int-1');

    expect(p.comment).not.toHaveBeenCalled();
  });

  it('si la base tombe pendant le traitement, le commentaire passe en « unknown »', async () => {
    const db = fakeDb({ getIntegration: vi.fn(async () => { throw new Error('connexion perdue'); }) });
    const out = await processFirstComment({ db, providers: registry(provider(async () => ({ commentId: 'x' }))) }, withComment());
    expect(out.result).toBe('unknown');
    expect(db.failFirstComment).toHaveBeenCalledWith('post-1', 'unknown', expect.stringContaining('connexion perdue'));
  });
});
