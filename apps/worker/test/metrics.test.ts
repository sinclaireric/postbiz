import { describe, expect, it, vi } from 'vitest';
import {
  COLLECT_EVERY_SECONDS, MISSING_SCOPE_RETRY_SECONDS, RECONNECT_RETRY_SECONDS, collectMetrics, retryDelaySeconds, type MetricsDb, type MetricsJob,
} from '../src/engine/metrics.ts';
import { MetricsUnavailableError, MissingScopeError, ReconnectRequiredError } from '../src/providers/errors.ts';
import type { ProviderRegistry } from '../src/providers/registry.ts';
import type { MetricPoint, MetricsResult, SocialProvider } from '../src/providers/types.ts';

const NOW = () => new Date('2026-10-24T10:30:00Z');
const job = (o: Partial<MetricsJob> = {}): MetricsJob => ({ id: 'int-1', orgId: 'org-1', provider: 'facebook', name: 'Maison Lune', internalId: 'PAGE1', settings: { page_id: 'PAGE1' }, attempts: 0, backfilled: false, ...o });
const pts = (...days: string[]): MetricPoint[] => days.map((day) => ({ day, metric: 'reach', value: 10 }));

function fakeDb(jobs: MetricsJob[] = [], o: Partial<MetricsDb> = {}) {
  const db: MetricsDb = {
    claim: vi.fn(async () => jobs),
    getAccessToken: vi.fn(async () => 'TOKEN'),
    record: vi.fn(async (_id, points) => points.length),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    markRefreshNeeded: vi.fn(async () => {}),
    ...o,
  };
  return db;
}

const withMetrics = (metrics: SocialProvider['metrics']): SocialProvider => ({ id: 'x', supportsThreads: false, supportsMedia: false, publish: async () => [], metrics });
const registry = (p: SocialProvider): ProviderRegistry => (id) => (['facebook', 'instagram', 'linkedin_page', 'youtube', 'tiktok', 'x'].includes(id) ? p : null);

describe('collectMetrics', () => {
  it('relève, enregistre et programme la collecte suivante dans 6 heures ; le passage initial est marqué fait', async () => {
    const db = fakeDb([job()]);
    const metrics = vi.fn(async (): Promise<MetricsResult> => ({ points: pts('2026-10-23', '2026-10-24') }));
    const stats = await collectMetrics({ db, providers: registry(withMetrics(metrics)) }, { now: NOW });
    expect(metrics).toHaveBeenCalledWith({ accessToken: 'TOKEN', integration: { id: 'int-1', internalId: 'PAGE1', settings: { page_id: 'PAGE1' } }, backfill: true, today: '2026-10-24' });
    expect(db.record).toHaveBeenCalledWith('int-1', pts('2026-10-23', '2026-10-24'));
    expect(db.complete).toHaveBeenCalledWith('int-1', { nextSeconds: COLLECT_EVERY_SECONDS, backfilled: true });
    expect(db.fail).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ collected: 1, partial: 0, errors: 0, points: 2 });
    expect(COLLECT_EVERY_SECONDS).toBe(6 * 3600);
  });

  it('après le premier passage, on ne relit que les derniers jours', async () => {
    const db = fakeDb([job({ backfilled: true })]);
    const metrics = vi.fn(async (): Promise<MetricsResult> => ({ points: [] }));
    await collectMetrics({ db, providers: registry(withMetrics(metrics)) }, { now: NOW });
    expect((metrics.mock.calls[0] as unknown[])[0]).toMatchObject({ backfill: false });
    expect(db.record).not.toHaveBeenCalled(); // rien à écrire
    expect(db.complete).toHaveBeenCalled();
  });

  it('ne réclame que les réseaux qui savent relever des statistiques ; rien n’est lu en mode essai', async () => {
    const db = fakeDb([]);
    const plain = withMetrics(undefined);
    await collectMetrics({ db, providers: registry(plain) });
    expect(db.claim).not.toHaveBeenCalled();
    await collectMetrics({ db, providers: registry(withMetrics(async () => ({ points: [] }))) });
    expect((db.claim as any).mock.calls[0][0].sort()).toEqual(['facebook', 'instagram', 'linkedin_page', 'tiktok', 'x', 'youtube']);
  });

  it('un relevé par jour et par métrique : le dernier gagne', async () => {
    const db = fakeDb([job()]);
    const dup: MetricPoint[] = [{ day: '2026-10-24', metric: 'followers', value: 1 }, { day: '2026-10-24', metric: 'followers', value: 2 }, { day: '2026-10-24', metric: 'reach', value: 3 }];
    await collectMetrics({ db, providers: registry(withMetrics(async () => ({ points: dup }))) }, { now: NOW });
    expect(db.record).toHaveBeenCalledWith('int-1', [{ day: '2026-10-24', metric: 'followers', value: 2 }, { day: '2026-10-24', metric: 'reach', value: 3 }]);
  });

  it('collecte partielle : les relevés lus sont gardés, le problème est enregistré, le passage initial sera retenté', async () => {
    const db = fakeDb([job()]);
    const metrics = async (): Promise<MetricsResult> => ({ points: [{ day: '2026-10-24', metric: 'followers', value: 5 }], problem: { kind: 'missing_scope', message: 'read_insights manquant' } });
    const stats = await collectMetrics({ db, providers: registry(withMetrics(metrics)) }, { now: NOW });
    expect(db.record).toHaveBeenCalledTimes(1);
    expect(db.complete).not.toHaveBeenCalled(); // backfilled_at n'est pas posé
    expect(db.fail).toHaveBeenCalledWith('int-1', { status: 'missing_scope', error: 'read_insights manquant', nextSeconds: MISSING_SCOPE_RETRY_SECONDS });
    expect(stats).toMatchObject({ partial: 1, missingScope: 1, collected: 0 });
  });

  it('autorisation manquante : statut dédié, revérifié dans 3 heures', async () => {
    const db = fakeDb([job()]);
    const stats = await collectMetrics({ db, providers: registry(withMetrics(async () => { throw new MissingScopeError('droit'); })) }, { now: NOW });
    expect(db.fail).toHaveBeenCalledWith('int-1', { status: 'missing_scope', error: 'droit', nextSeconds: 3 * 3600 });
    expect(db.markRefreshNeeded).not.toHaveBeenCalled();
    expect(stats.missingScope).toBe(1);
  });

  it('jeton refusé : le canal passe à « à reconnecter » et on réessaie dans 24 h', async () => {
    const db = fakeDb([job()]);
    const stats = await collectMetrics({ db, providers: registry(withMetrics(async () => { throw new ReconnectRequiredError(); })) }, { now: NOW });
    expect(db.markRefreshNeeded).toHaveBeenCalledWith('int-1');
    expect(db.fail).toHaveBeenCalledWith('int-1', expect.objectContaining({ status: 'error', nextSeconds: RECONNECT_RETRY_SECONDS }));
    expect(stats.reconnectNeeded).toBe(1);
  });

  it('panne passagère : délai croissant selon le nombre d’échecs précédents', async () => {
    for (const [attempts, seconds] of [[0, 900], [1, 1800], [2, 3600], [10, 12 * 3600]] as const) {
      const db = fakeDb([job({ attempts })]);
      await collectMetrics({ db, providers: registry(withMetrics(async () => { throw new MetricsUnavailableError('panne'); })) }, { now: NOW });
      expect(db.fail).toHaveBeenCalledWith('int-1', { status: 'error', error: 'panne', nextSeconds: seconds });
    }
    expect(retryDelaySeconds(0)).toBe(900);
    expect(retryDelaySeconds(-3)).toBe(900);
    expect(retryDelaySeconds(100)).toBe(12 * 3600);
  });

  it('jeton illisible ou absent : échec enregistré, le réseau n’est pas contacté', async () => {
    const db = fakeDb([job()], { getAccessToken: vi.fn(async () => null) });
    const metrics = vi.fn(async (): Promise<MetricsResult> => ({ points: [] }));
    const stats = await collectMetrics({ db, providers: registry(withMetrics(metrics)) }, { now: NOW });
    expect(metrics).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith('int-1', expect.objectContaining({ status: 'error' }));
    expect(stats.errors).toBe(1);
  });

  it('un canal en échec ne bloque pas les suivants', async () => {
    const db = fakeDb([job({ id: 'a' }), job({ id: 'b' })]);
    let n = 0;
    const metrics = async (): Promise<MetricsResult> => {
      if (n++ === 0) throw new MetricsUnavailableError('panne');
      return { points: pts('2026-10-24') };
    };
    const stats = await collectMetrics({ db, providers: registry(withMetrics(metrics)) }, { now: NOW });
    expect(db.fail).toHaveBeenCalledWith('a', expect.anything());
    expect(db.complete).toHaveBeenCalledWith('b', expect.anything());
    expect(stats).toMatchObject({ collected: 1, errors: 1 });
  });

  it('si l’enregistrement de l’échec échoue aussi, on continue (le verrou expirera)', async () => {
    const db = fakeDb([job({ id: 'a' }), job({ id: 'b' })], { fail: vi.fn(async () => { throw new Error('base indisponible'); }) });
    const log = vi.fn();
    const metrics = vi.fn(async (): Promise<MetricsResult> => { throw new MetricsUnavailableError('panne'); });
    await expect(collectMetrics({ db, providers: registry(withMetrics(metrics)) }, { now: NOW }, log)).resolves.toBeDefined();
    expect(metrics).toHaveBeenCalledTimes(2);
  });

  it('un jeton n’apparaît jamais dans les journaux', async () => {
    const db = fakeDb([job()]);
    const log = vi.fn();
    await collectMetrics({ db, providers: registry(withMetrics(async () => { throw new MetricsUnavailableError('Facebook a répondu 500.'); })) }, { now: NOW }, log);
    expect(JSON.stringify(log.mock.calls)).not.toContain('TOKEN');
  });

  it('respecte la limite de canaux par passage', async () => {
    const db = fakeDb([]);
    await collectMetrics({ db, providers: registry(withMetrics(async () => ({ points: [] }))) }, { limit: 3 });
    expect((db.claim as any).mock.calls[0][1]).toMatchObject({ limit: 3 });
  });
});
