import { describe, expect, it, vi } from 'vitest';
import { MetricsUnavailableError, MissingScopeError, ReconnectRequiredError } from '../src/providers/errors.ts';
import { classifyReadFailure, read } from '../src/providers/http.ts';
import { addDays, count, daysBetween, gather, inBatches, metaDay, point, sumValue, unix, windowFor } from '../src/providers/insights/common.ts';
import { facebookMetrics } from '../src/providers/insights/facebook.ts';
import { instagramMetrics } from '../src/providers/insights/instagram.ts';
import { linkedInPageMetrics } from '../src/providers/insights/linkedin.ts';
import { tiktokMetrics } from '../src/providers/insights/tiktok.ts';
import { xMetrics } from '../src/providers/insights/x.ts';
import { youtubeMetrics } from '../src/providers/insights/youtube.ts';
import { createRegistry } from '../src/providers/registry.ts';
import type { MetricsInput } from '../src/providers/types.ts';

const TODAY = '2026-10-24';
const input = (o: Partial<MetricsInput> = {}, settings: Record<string, unknown> = {}, internalId = 'ACCOUNT1'): MetricsInput => ({
  accessToken: 'TOK', integration: { id: 'i', internalId, settings }, backfill: false, today: TODAY, ...o,
});

/** Faux réseau : une réponse par adresse (la première qui contient le motif), et un journal des appels. */
function network(routes: [pattern: string | RegExp, status: number, body: unknown][]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes.find(([p]) => (typeof p === 'string' ? String(url).includes(p) : p.test(String(url))));
    if (!route) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(route[2]), { status: route[1] });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('aides communes', () => {
  it('jours : addDays, daysBetween, unix', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-22', '2026-10-24')).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
    expect(unix('1970-01-02')).toBe(86_400);
  });

  it('fenêtre : 90 jours au premier passage, 7 jours ensuite, jour en cours inclus', () => {
    expect(windowFor(TODAY, true, 90)).toEqual({ since: '2026-07-27', until: TODAY });
    expect(windowFor(TODAY, false, 90)).toEqual({ since: '2026-10-18', until: TODAY });
    expect(windowFor(TODAY, true, 30).since).toBe('2026-09-25');
  });

  it('count : entiers et textes numériques, jamais un zéro inventé', () => {
    expect(count(12.6)).toBe(13);
    expect(count('1300')).toBe(1300);
    for (const bad of [null, undefined, '', 'abc', -1, NaN, {}]) expect(count(bad)).toBeNull();
    expect(point('2026-10-24', 'reach', undefined)).toEqual([]);
    expect(point('2026-10-24', 'reach', 0)).toEqual([{ day: '2026-10-24', metric: 'reach', value: 0 }]);
  });

  it('metaDay : la fin de la période désigne la veille', () => {
    expect(metaDay('2026-10-24T07:00:00+0000')).toBe('2026-10-23');
    expect(metaDay('2026-10-24T07:00:00+00:00')).toBe('2026-10-23');
    expect(metaDay('pas une date')).toBeNull();
  });

  it('sumValue additionne une valeur ventilée', () => {
    expect(sumValue({ paid: 3, organic: 9 })).toBe(12);
    expect(sumValue(5)).toBe(5);
    expect(sumValue({ a: 'x' })).toBeNull();
    expect(sumValue(null)).toBeNull();
  });

  it('inBatches limite le nombre de requêtes simultanées', async () => {
    let live = 0;
    let peak = 0;
    const out = await inBatches([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('gather : assembler des relevés dont une partie peut échouer', () => {
  const ok = (day: string, v: number) => Promise.resolve(point(day, 'reach', v));

  it('tout a réussi : les relevés, sans problème', async () => {
    expect(await gather([ok('2026-10-23', 1), ok('2026-10-24', 2)])).toEqual({ points: [{ day: '2026-10-23', metric: 'reach', value: 1 }, { day: '2026-10-24', metric: 'reach', value: 2 }] });
  });

  it('une partie a échoué : on garde les relevés lus et on signale l’autorisation manquante en priorité', async () => {
    const r = await gather([ok('2026-10-23', 1), Promise.reject(new MetricsUnavailableError('panne')), Promise.reject(new MissingScopeError('droit'))]);
    expect(r.points).toHaveLength(1);
    expect(r.problem).toEqual({ kind: 'missing_scope', message: 'droit' });
  });

  it('une panne passagère seule est un problème « error »', async () => {
    const r = await gather([ok('2026-10-23', 1), Promise.reject(new MetricsUnavailableError('panne'))]);
    expect(r.problem).toEqual({ kind: 'error', message: 'panne' });
  });

  it('un jeton refusé l’emporte sur tout', async () => {
    await expect(gather([ok('2026-10-23', 1), Promise.reject(new ReconnectRequiredError())])).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('tout a échoué : l’erreur est levée (autorisation manquante d’abord)', async () => {
    await expect(gather([Promise.reject(new MetricsUnavailableError('a')), Promise.reject(new MissingScopeError('b'))])).rejects.toBeInstanceOf(MissingScopeError);
    await expect(gather([Promise.reject(new MetricsUnavailableError('a'))])).rejects.toBeInstanceOf(MetricsUnavailableError);
    await expect(gather([Promise.reject('texte')])).rejects.toBeInstanceOf(MetricsUnavailableError);
  });

  it('aucun relevé et aucune erreur : liste vide', async () => {
    expect(await gather([Promise.resolve([])])).toEqual({ points: [] });
  });
});

describe('classer un refus du réseau', () => {
  it('401 et code 190 : le jeton est refusé', () => {
    expect(classifyReadFailure(401, {})).toBe('reconnect');
    expect(classifyReadFailure(400, { error: { code: 190, message: 'Error validating access token' } })).toBe('reconnect');
  });

  it('403, codes de permission de Meta, scope insuffisant : autorisation manquante', () => {
    expect(classifyReadFailure(403, {})).toBe('scope');
    expect(classifyReadFailure(400, { error: { code: 10, message: '(#10) Application does not have permission for this action' } })).toBe('scope');
    expect(classifyReadFailure(400, { error: { code: 200, message: '(#200) Requires read_insights permission' } })).toBe('scope');
    expect(classifyReadFailure(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } })).toBe('scope');
    expect(classifyReadFailure(401, { error: { code: 'scope_not_authorized', message: 'The user did not authorize the scope' } })).toBe('scope'); // TikTok : 401 mais pas un jeton révoqué
  });

  it('quota, 429, 5xx, réponse inattendue : panne passagère', () => {
    expect(classifyReadFailure(429, {})).toBe('transient');
    expect(classifyReadFailure(503, {})).toBe('transient');
    expect(classifyReadFailure(403, { error: { errors: [{ reason: 'quotaExceeded' }], message: 'Quota exceeded' } })).toBe('transient');
    expect(classifyReadFailure(400, { error: { code: 100, message: '(#100) The value must be a valid insights metric' } })).toBe('transient');
  });

  it('read() lève l’erreur qui correspond, sans jamais recopier le jeton', async () => {
    const f = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await expect(read(f(401, {}), 'https://x.test', { provider: 'Facebook', headers: { Authorization: 'Bearer SECRET' } })).rejects.toBeInstanceOf(ReconnectRequiredError);
    const scope = await read(f(403, { error: { message: 'pas de droit' } }), 'https://x.test', { provider: 'Facebook' }).catch((e) => e);
    expect(scope).toBeInstanceOf(MissingScopeError);
    expect(scope.message).toContain('pas de droit');
    await expect(read(f(500, {}), 'https://x.test', { provider: 'Facebook' })).rejects.toBeInstanceOf(MetricsUnavailableError);
    const down = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(read(down, 'https://x.test', { provider: 'Facebook' })).rejects.toBeInstanceOf(MetricsUnavailableError);
    const html = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(read(html, 'https://x.test', { provider: 'Facebook' })).rejects.toBeInstanceOf(MetricsUnavailableError);
    const e = await read(down, 'https://x.test', { provider: 'Facebook', headers: { Authorization: 'Bearer SECRET' } }).catch((x) => x);
    expect(e.message).not.toContain('SECRET');
  });
});

describe('Facebook', () => {
  const insights = {
    data: [
      { name: 'page_total_media_view_unique', values: [{ value: 1200, end_time: '2026-10-23T07:00:00+0000' }, { value: 1500, end_time: '2026-10-24T07:00:00+0000' }] },
      { name: 'page_post_engagements', values: [{ value: { paid: 4, organic: 40 }, end_time: '2026-10-23T07:00:00+0000' }] },
      { name: 'page_daily_follows', values: [{ value: 9, end_time: '2026-10-23T07:00:00+0000' }] }, // pas demandé : ignoré
    ],
  };

  it('relève portée, interactions par jour et abonnés du jour, avec le jeton en en-tête', async () => {
    const { f, calls } = network([['/insights', 200, insights], ['fields=', 200, { followers_count: 5130, fan_count: 5000 }]]);
    const r = await facebookMetrics(f)(input({}, {}, 'PAGE1'));
    expect(r.problem).toBeUndefined();
    expect(r.points).toEqual(expect.arrayContaining([
      { day: '2026-10-22', metric: 'reach', value: 1200 },
      { day: '2026-10-23', metric: 'reach', value: 1500 },
      { day: '2026-10-22', metric: 'engagement', value: 44 },
      { day: TODAY, metric: 'followers', value: 5130 },
    ]));
    expect(r.points).toHaveLength(4);
    const url = new URL(calls.find((c) => c.url.includes('/insights'))!.url);
    expect(url.pathname).toBe('/v23.0/PAGE1/insights');
    expect(url.searchParams.get('metric')).toBe('page_total_media_view_unique,page_post_engagements');
    expect(url.searchParams.get('period')).toBe('day');
    expect(calls.every((c) => c.headers.Authorization === 'Bearer TOK')).toBe(true);
    expect(calls.every((c) => !c.url.includes('TOK'))).toBe(true); // jamais de jeton dans l'adresse
  });

  it('première collecte : 90 jours ; ensuite 7', async () => {
    const { f, calls } = network([['/insights', 200, { data: [] }], ['fields=', 200, { followers_count: 1 }]]);
    await facebookMetrics(f)(input({ backfill: true }));
    const first = new URL(calls[0]!.url).searchParams;
    expect((Number(first.get('until')) - Number(first.get('since'))) / 86_400).toBe(90); // du 27 juil. à minuit au 25 oct. à minuit : 90 jours, aujourd’hui compris
    calls.length = 0;
    await facebookMetrics(f)(input({ backfill: false }));
    const next = new URL(calls[0]!.url).searchParams;
    expect((Number(next.get('until')) - Number(next.get('since'))) / 86_400).toBe(7);
  });

  it('statistiques refusées mais abonnés lus : on garde les abonnés et on demande de reconnecter', async () => {
    const { f } = network([['/insights', 400, { error: { code: 200, message: '(#200) Requires read_insights permission' } }], ['fields=', 200, { followers_count: 5130 }]]);
    const r = await facebookMetrics(f)(input());
    expect(r.points).toEqual([{ day: TODAY, metric: 'followers', value: 5130 }]);
    expect(r.problem).toMatchObject({ kind: 'missing_scope' });
  });

  it('tout est refusé : l’erreur est levée', async () => {
    const { f } = network([['', 403, { error: { message: 'non' } }]]);
    await expect(facebookMetrics(f)(input())).rejects.toBeInstanceOf(MissingScopeError);
    const gone = network([['', 401, {}]]);
    await expect(facebookMetrics(gone.f)(input())).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('abonnés : à défaut de followers_count, le nombre de mentions J’aime (fan_count) ; rien si absent', async () => {
    const a = network([['/insights', 200, { data: [] }], ['fields=', 200, { fan_count: 77 }]]);
    expect((await facebookMetrics(a.f)(input())).points).toEqual([{ day: TODAY, metric: 'followers', value: 77 }]);
    const b = network([['/insights', 200, { data: [] }], ['fields=', 200, {}]]);
    expect((await facebookMetrics(b.f)(input())).points).toEqual([]);
  });
});

describe('Instagram', () => {
  const routes = (): [string, number, unknown][] => [
    ['metric=reach', 200, { data: [{ name: 'reach', values: [{ value: 800, end_time: '2026-10-23T07:00:00+0000' }, { value: 950, end_time: '2026-10-24T07:00:00+0000' }] }] }],
    ['metric=total_interactions', 200, { data: [{ name: 'total_interactions', total_value: { value: 31 } }] }],
    ['fields=followers_count', 200, { followers_count: 8420 }],
  ];

  it('relève la portée, les interactions jour par jour sur 7 jours et les abonnés', async () => {
    const { f, calls } = network(routes());
    const r = await instagramMetrics(f)(input({}, { ig_user_id: 'IG1' }));
    expect(r.problem).toBeUndefined();
    expect(r.points.filter((p) => p.metric === 'engagement').map((p) => p.day)).toEqual(daysBetween('2026-10-18', TODAY));
    expect(r.points.filter((p) => p.metric === 'engagement').every((p) => p.value === 31)).toBe(true);
    expect(r.points).toContainEqual({ day: '2026-10-22', metric: 'reach', value: 800 });
    expect(r.points).toContainEqual({ day: TODAY, metric: 'followers', value: 8420 });
    expect(calls.filter((c) => c.url.includes('total_interactions'))).toHaveLength(7);
    expect(calls.every((c) => c.url.startsWith('https://graph.facebook.com/v23.0/IG1'))).toBe(true);
  });

  it('première collecte : 30 jours (limite de Meta)', async () => {
    const { f, calls } = network(routes());
    await instagramMetrics(f)(input({ backfill: true }, { ig_user_id: 'IG1' }));
    expect(calls.filter((c) => c.url.includes('total_interactions'))).toHaveLength(30);
  });

  it('Instagram Login : graph.instagram.com et identifiant du compte', async () => {
    const { f, calls } = network(routes());
    await instagramMetrics(f)(input({}, { graph_host: 'graph.instagram.com', ig_user_id: 'IG9' }, 'IG9'));
    expect(calls.every((c) => c.url.startsWith('https://graph.instagram.com/v23.0/IG9'))).toBe(true);
  });

  it('un serveur choisi dans les réglages mais hors liste n’est jamais contacté avec le jeton', async () => {
    const { f, calls } = network(routes());
    await instagramMetrics(f)(input({}, { graph_host: 'evil.example', ig_user_id: 'IG1' }));
    expect(calls.every((c) => c.url.startsWith('https://graph.facebook.com/'))).toBe(true);
  });

  it('autorisation manquante sur les statistiques : abonnés gardés, problème signalé', async () => {
    const { f } = network([['metric=', 400, { error: { code: 10, message: '(#10) permission' } }], ['fields=followers_count', 200, { followers_count: 12 }]]);
    const r = await instagramMetrics(f)(input({}, { ig_user_id: 'IG1' }));
    expect(r.points).toEqual([{ day: TODAY, metric: 'followers', value: 12 }]);
    expect(r.problem?.kind).toBe('missing_scope');
  });
});

describe('Page LinkedIn', () => {
  const stats = {
    elements: [
      { timeRange: { start: Date.parse('2026-10-22T00:00:00Z'), end: Date.parse('2026-10-23T00:00:00Z') }, totalShareStatistics: { impressionCount: 900, likeCount: 10, commentCount: 2, shareCount: 1, clickCount: 40, engagement: 0.05 } },
      { timeRange: { start: Date.parse('2026-10-23T00:00:00Z'), end: Date.parse('2026-10-24T00:00:00Z') }, totalShareStatistics: { impressionCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 } },
    ],
  };

  it('relève impressions et interactions par jour, et les abonnés de la Page', async () => {
    const { f, calls } = network([['organizationalEntityShareStatistics', 200, stats], ['networkSizes', 200, { firstDegreeSize: 2310 }]]);
    const r = await linkedInPageMetrics(f, { LINKEDIN_API_VERSION: '202601' })(input({}, { author_urn: 'urn:li:organization:111' }, '111'));
    expect(r.points).toEqual(expect.arrayContaining([
      { day: '2026-10-22', metric: 'reach', value: 900 },
      { day: '2026-10-22', metric: 'engagement', value: 13 }, // j'aime + commentaires + partages, pas les clics
      { day: '2026-10-23', metric: 'reach', value: 0 },
      { day: '2026-10-23', metric: 'engagement', value: 0 },
      { day: TODAY, metric: 'followers', value: 2310 },
    ]));
    const share = calls.find((c) => c.url.includes('ShareStatistics'))!;
    expect(share.url).toContain('organizationalEntity=urn%3Ali%3Aorganization%3A111');
    expect(share.url).toMatch(/timeIntervals=\(timeRange:\(start:\d+,end:\d+\),timeGranularityType:DAY\)/);
    expect(share.headers).toMatchObject({ Authorization: 'Bearer TOK', 'X-Restli-Protocol-Version': '2.0.0' });
    expect(share.headers['LinkedIn-Version']).toMatch(/^\d{6}$/);
    expect(calls.find((c) => c.url.includes('networkSizes'))!.url).toContain('edgeType=COMPANY_FOLLOWED_BY_MEMBER');
  });

  it('sans author_urn : l’organisation vient de l’identifiant du canal', async () => {
    const { f, calls } = network([['ShareStatistics', 200, { elements: [] }], ['networkSizes', 200, {}]]);
    await linkedInPageMetrics(f)(input({}, {}, '555'));
    expect(calls[0]!.url).toContain('urn%3Ali%3Aorganization%3A555');
  });

  it('403 : autorisation manquante', async () => {
    const { f } = network([['', 403, { message: 'ACCESS_DENIED' }]]);
    await expect(linkedInPageMetrics(f)(input())).rejects.toBeInstanceOf(MissingScopeError);
  });

  it('seules les Pages ont des statistiques : le profil personnel n’en déclare pas', () => {
    const registry = createRegistry({ dryRun: false, env: {} });
    expect(registry('linkedin_page')?.metrics).toBeTypeOf('function');
    expect(registry('linkedin')?.metrics).toBeUndefined();
  });
});

describe('YouTube', () => {
  const report = { columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'likes' }, { name: 'comments' }, { name: 'shares' }], rows: [['2026-10-22', 300, 20, 4, 1], ['2026-10-23', 0, 0, 0, 0]] };

  it('relève vues et interactions par jour, et le nombre d’abonnés', async () => {
    const { f, calls } = network([['youtubeanalytics.googleapis.com', 200, report], ['youtube/v3/channels', 200, { items: [{ statistics: { subscriberCount: '1960', hiddenSubscriberCount: false } }] }]]);
    const r = await youtubeMetrics(f)(input({ backfill: true }));
    expect(r.points).toEqual(expect.arrayContaining([
      { day: '2026-10-22', metric: 'reach', value: 300 },
      { day: '2026-10-22', metric: 'engagement', value: 25 },
      { day: '2026-10-23', metric: 'reach', value: 0 },
      { day: TODAY, metric: 'followers', value: 1960 },
    ]));
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get('ids')).toBe('channel==MINE');
    expect(q.get('startDate')).toBe('2026-07-27');
    expect(q.get('endDate')).toBe(TODAY);
    expect(q.get('dimensions')).toBe('day');
  });

  it('abonnés masqués par la chaîne : pas de relevé', async () => {
    const { f } = network([['youtubeanalytics', 200, { columnHeaders: [], rows: [] }], ['youtube/v3/channels', 200, { items: [{ statistics: { subscriberCount: '12', hiddenSubscriberCount: true } }] }]]);
    expect((await youtubeMetrics(f)(input())).points).toEqual([]);
  });

  it('autorisation yt-analytics manquante : abonnés gardés, problème signalé ; quota dépassé : simple panne', async () => {
    const scope = network([['youtubeanalytics', 403, { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'insufficientPermissions' }], message: 'Insufficient Permission' } }], ['youtube/v3/channels', 200, { items: [{ statistics: { subscriberCount: '12' } }] }]]);
    expect((await youtubeMetrics(scope.f)(input())).problem?.kind).toBe('missing_scope');
    const quota = network([['youtubeanalytics', 403, { error: { errors: [{ reason: 'quotaExceeded' }], message: 'Quota exceeded' } }], ['youtube/v3/channels', 200, { items: [{ statistics: { subscriberCount: '12' } }] }]]);
    expect((await youtubeMetrics(quota.f)(input())).problem?.kind).toBe('error');
  });
});

describe('TikTok et X : abonnés seulement', () => {
  it('TikTok : follower_count du jour', async () => {
    const { f, calls } = network([['user/info', 200, { data: { user: { follower_count: 6200 } }, error: { code: 'ok' } }]]);
    const r = await tiktokMetrics(f)(input());
    expect(r.points).toEqual([{ day: TODAY, metric: 'followers', value: 6200 }]);
    expect(new URL(calls[0]!.url).searchParams.get('fields')).toBe('follower_count');
  });

  it('TikTok : une erreur dans un corps 200 est traitée comme un refus', async () => {
    const scope = network([['user/info', 200, { error: { code: 'scope_not_authorized', message: 'no' } }]]);
    await expect(tiktokMetrics(scope.f)(input())).rejects.toBeInstanceOf(MissingScopeError);
    const other = network([['user/info', 200, { error: { code: 'internal_error' } }]]);
    await expect(tiktokMetrics(other.f)(input())).rejects.toBeInstanceOf(MetricsUnavailableError);
  });

  it('X : followers_count du jour', async () => {
    const { f, calls } = network([['users/me', 200, { data: { public_metrics: { followers_count: 3480 } } }]]);
    expect((await xMetrics(f)(input())).points).toEqual([{ day: TODAY, metric: 'followers', value: 3480 }]);
    expect(new URL(calls[0]!.url).searchParams.get('user.fields')).toBe('public_metrics');
  });

  it('X : accès refusé par l’offre → autorisation manquante', async () => {
    const { f } = network([['users/me', 403, { title: 'Forbidden', detail: 'not permitted' }]]);
    await expect(xMetrics(f)(input())).rejects.toBeInstanceOf(MissingScopeError);
  });
});

describe('registre', () => {
  it('chaque réseau qui sait relever des statistiques le déclare ; le mode essai n’en déclare aucun', () => {
    const registry = createRegistry({ dryRun: false, env: {} });
    for (const id of ['facebook', 'instagram', 'linkedin_page', 'youtube', 'tiktok', 'x']) expect(registry(id)?.metrics, id).toBeTypeOf('function');
    const dry = createRegistry({ dryRun: true });
    expect(dry('facebook')?.metrics).toBeUndefined();
    void vi;
  });
});
