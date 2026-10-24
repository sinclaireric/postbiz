import { describe, expect, it } from 'vitest';
import { barHeight, linePaths } from './chart';
import { demoDailyRows } from './demo';
import { formatAverage, formatChange, formatCount, formatDay, formatDayYear, formatMetric, formatSigned } from './format';
import {
  activityRows, addDays, analyticsHref, buildView, dayRange, flowValues, metricDetail, metricRowsFromDb, parseAnalyticsParams, performanceTable, periodWindows,
  queueCounts, queueSummary, recentPosts, stockValues, summarizeMetric, variation,
} from './logic';
import type { DailyMetric, DailyMetricRow, RecentPost } from './types';

const row = (integrationId: string, day: string, metric: DailyMetric, value: number): DailyMetricRow => ({ integrationId, day, metric, value });
const TODAY = '2026-10-24';

describe('jours et fenêtres', () => {
  it('addDays traverse les mois, les années et les années bissextiles', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('dayRange est inclusif aux deux bouts, vide si le début est après la fin', () => {
    expect(dayRange('2026-10-22', '2026-10-24')).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
    expect(dayRange('2026-10-24', '2026-10-24')).toEqual(['2026-10-24']);
    expect(dayRange('2026-10-25', '2026-10-24')).toEqual([]);
  });

  it('la période finit aujourd’hui et la précédente la touche, sans trou ni recouvrement', () => {
    const w = periodWindows(7, TODAY);
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toBe('2026-10-18');
    expect(w.days[6]).toBe(TODAY);
    expect(w.prevDays).toHaveLength(7);
    expect(w.prevTo).toBe('2026-10-17');
    expect(w.prevFrom).toBe('2026-10-11');
    expect(w.all).toEqual([...w.prevDays, ...w.days]);
  });

  it('couvre 90 jours + 90 jours', () => {
    const w = periodWindows(90, TODAY);
    expect(w.days).toHaveLength(90);
    expect(w.all).toHaveLength(180);
    expect(new Set(w.all).size).toBe(180);
  });
});

describe('lecture de l’adresse', () => {
  const ids = ['a', 'b'];

  it('valeurs valides', () => {
    expect(parseAnalyticsParams({ canal: 'b', periode: '90', metrique: 'replies' }, ids)).toEqual({ days: 90, metric: 'replies', channel: 'b' });
  });

  it('défauts : 30 jours, tous les canaux, pas de métrique imposée', () => {
    expect(parseAnalyticsParams({}, ids)).toEqual({ days: 30, metric: null, channel: null });
  });

  it('une valeur inconnue ou hostile retombe sur le défaut', () => {
    expect(parseAnalyticsParams({ canal: 'zzz', periode: '15', metrique: 'revenue' }, ids)).toEqual({ days: 30, metric: null, channel: null });
    expect(parseAnalyticsParams({ canal: '../../etc', periode: 'NaN', metrique: '__proto__' }, ids)).toEqual({ days: 30, metric: null, channel: null });
    expect(parseAnalyticsParams({ periode: '' }, ids).days).toBe(30);
  });

  it('un paramètre répété : le premier compte', () => {
    expect(parseAnalyticsParams({ periode: ['7', '90'], canal: ['a', 'b'] }, ids)).toMatchObject({ days: 7, channel: 'a' });
    expect(parseAnalyticsParams({ canal: [] }, ids).channel).toBeNull();
  });

  it('analyticsHref omet les valeurs par défaut et se relit à l’identique', () => {
    expect(analyticsHref({ days: 30, metric: null, channel: null })).toBe('/app/analyses');
    expect(analyticsHref({ days: 7, metric: 'published', channel: 'a' })).toBe('/app/analyses?canal=a&periode=7&metrique=published');
    const state = { days: 90, metric: 'followers', channel: 'b' } as const;
    const href = analyticsHref(state);
    const q = Object.fromEntries(new URL(href, 'https://x.test').searchParams);
    expect(parseAnalyticsParams(q, ids)).toEqual(state);
  });

  it('encode un identifiant de canal contenant des caractères spéciaux', () => {
    const href = analyticsHref({ days: 30, metric: null, channel: 'a&b=c' });
    expect(href).toBe('/app/analyses?canal=a%26b%3Dc');
  });
});

describe('variation', () => {
  it('hausse, baisse, stable', () => {
    expect(variation(120, 100)).toEqual({ diff: 20, percent: 0.2, direction: 'up' });
    expect(variation(75, 100)).toEqual({ diff: -25, percent: -0.25, direction: 'down' });
    expect(variation(5, 5)).toEqual({ diff: 0, percent: 0, direction: 'flat' });
  });
  it('période précédente à zéro : pas de pourcentage, mais l’écart brut', () => {
    expect(variation(8, 0)).toEqual({ diff: 8, percent: null, direction: 'up' });
    expect(variation(0, 0)).toEqual({ diff: 0, percent: null, direction: 'flat' });
  });
  it('période précédente inconnue : aucune variation', () => {
    expect(variation(8, null)).toBeNull();
  });
});

describe('flux (publications, messages…)', () => {
  const days = ['2026-10-22', '2026-10-23', '2026-10-24'];
  const scope = new Set(['a', 'b']);
  const rows = [
    row('a', '2026-10-22', 'published', 2), row('b', '2026-10-22', 'published', 1), row('a', '2026-10-24', 'published', 4),
    row('a', '2026-10-23', 'received', 9), row('c', '2026-10-23', 'published', 50),
  ];

  it('additionne les canaux du périmètre, un jour sans ligne vaut zéro', () => {
    expect(flowValues(rows, 'published', scope, days)).toEqual([3, 0, 4]);
  });
  it('ignore les canaux hors périmètre et les autres métriques', () => {
    expect(flowValues(rows, 'published', new Set(['a']), days)).toEqual([2, 0, 4]);
    expect(flowValues(rows, 'received', scope, days)).toEqual([0, 9, 0]);
  });
  it('ignore les jours hors fenêtre', () => {
    expect(flowValues([row('a', '2025-01-01', 'published', 9)], 'published', scope, days)).toEqual([0, 0, 0]);
  });
});

describe('niveau (abonnés)', () => {
  const days = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  it('garde le dernier relevé de chaque canal jusqu’au suivant, inconnu avant le premier', () => {
    const rows = [row('a', '2026-10-21', 'followers', 100), row('a', '2026-10-23', 'followers', 110), row('b', '2026-10-22', 'followers', 50)];
    expect(stockValues(rows, 'followers', new Set(['a', 'b']), days)).toEqual([null, 100, 150, 160]);
  });
  it('aucun relevé : tout est inconnu (pas zéro)', () => {
    expect(stockValues([], 'followers', new Set(['a']), days)).toEqual([null, null, null, null]);
  });
});

describe('résumé d’une métrique', () => {
  const w = periodWindows(7, TODAY); // 18→24 oct. ; précédente 11→17 oct.

  it('publications : total, précédent, variation, une valeur par jour', () => {
    const rows = [
      row('a', '2026-10-12', 'published', 2), row('a', '2026-10-17', 'published', 2),
      row('a', '2026-10-18', 'published', 3), row('a', '2026-10-24', 'published', 3), row('b', '2026-10-20', 'published', 2),
    ];
    const s = summarizeMetric(rows, 'published', new Set(['a', 'b']), w);
    expect(s).toMatchObject({ available: true, value: 8, previous: 4 });
    expect(s.change).toEqual({ diff: 4, percent: 1, direction: 'up' });
    expect(s.values).toEqual([3, 0, 2, 0, 0, 0, 3]);
  });

  it('une activité à zéro reste une mesure : disponible, valeur 0, pas de division par zéro', () => {
    const s = summarizeMetric([], 'published', new Set(['a']), w);
    expect(s).toMatchObject({ available: true, value: 0, previous: 0 });
    expect(s.change).toEqual({ diff: 0, percent: null, direction: 'flat' });
  });

  it('audience sans aucune ligne : indisponible, jamais un zéro', () => {
    const s = summarizeMetric([], 'reach', new Set(['a']), w);
    expect(s).toMatchObject({ available: false, value: null, previous: null, change: null });
    expect(s.values.every((v) => v === null)).toBe(true);
  });

  it('audience : pas de comparaison si la période précédente n’a aucun relevé', () => {
    const s = summarizeMetric([row('a', '2026-10-20', 'reach', 500)], 'reach', new Set(['a']), w);
    expect(s).toMatchObject({ available: true, value: 500, previous: null, change: null });
  });

  it('abonnés : dernière valeur, évolution depuis la fin de la période précédente', () => {
    const rows = [row('a', '2026-10-17', 'followers', 1000), row('a', '2026-10-24', 'followers', 1050)];
    const s = summarizeMetric(rows, 'followers', new Set(['a']), w);
    expect(s).toMatchObject({ available: true, value: 1050, previous: 1000 });
    expect(s.change).toEqual({ diff: 50, percent: 0.05, direction: 'up' });
  });

  it('abonnés : à défaut de relevé avant la période, on part du premier relevé de la période', () => {
    const rows = [row('a', '2026-10-19', 'followers', 200), row('a', '2026-10-24', 'followers', 230)];
    const s = summarizeMetric(rows, 'followers', new Set(['a']), w);
    expect(s).toMatchObject({ value: 230, previous: 200 });
    expect(s.change?.diff).toBe(30);
  });

  it('abonnés : un canal connecté en cours de route ne compte pas comme une croissance', () => {
    const rows = [
      row('a', '2026-10-17', 'followers', 1000), row('a', '2026-10-24', 'followers', 1020),
      row('b', '2026-10-23', 'followers', 5000), row('b', '2026-10-24', 'followers', 5000), // b n'a qu'un jour d'historique : un seul relevé retenu
    ];
    const s = summarizeMetric(rows, 'followers', new Set(['a', 'b']), w);
    expect(s.value).toBe(6020);
    // b est comparé à son premier relevé de la période (même niveau) : l'évolution n'est pas gonflée de ses 5 000 abonnés
    expect(s.change?.diff).toBe(20);
  });

  it('un seul relevé pour un canal : rien à comparer', () => {
    const s = summarizeMetric([row('a', '2026-10-24', 'followers', 300)], 'followers', new Set(['a']), w);
    expect(s).toMatchObject({ available: true, value: 300, previous: null, change: null });
  });

  it('détail : moyenne par jour et meilleur jour d’un flux', () => {
    const rows = [row('a', '2026-10-19', 'published', 2), row('a', '2026-10-22', 'published', 5), row('a', '2026-10-24', 'published', 5)];
    const d = metricDetail(summarizeMetric(rows, 'published', new Set(['a']), w), w);
    expect(d.average).toBeCloseTo(12 / 7);
    expect(d.peak).toEqual({ day: '2026-10-24', value: 5 }); // à égalité, le plus récent
  });

  it('détail : pas de meilleur jour quand tout est à zéro', () => {
    const d = metricDetail(summarizeMetric([], 'published', new Set(['a']), w), w);
    expect(d.peak).toBeNull();
    expect(d.average).toBe(0);
  });

  it('détail : métrique indisponible sans moyenne ni pic', () => {
    expect(metricDetail(summarizeMetric([], 'followers', new Set(['a']), w), w)).toMatchObject({ average: null, peak: null });
  });
});

describe('taux d’engagement', () => {
  const w = periodWindows(7, TODAY); // 18→24 oct. ; précédente 11→17 oct.
  const both = (eng: number, reach: number, day: string, id = 'a') => [row(id, day, 'engagement', eng), row(id, day, 'reach', reach)];

  it('divise les totaux de la période (pas la moyenne des taux de chaque jour)', () => {
    const rows = [...both(1, 10, '2026-10-20'), ...both(50, 100, '2026-10-21')];
    const s = summarizeMetric(rows, 'engagementRate', new Set(['a']), w);
    expect(s.value).toBeCloseTo(51 / 110);
    expect(s.values[2]).toBeCloseTo(0.1); // 20 oct.
    expect(s.values[3]).toBeCloseTo(0.5); // 21 oct.
    expect(s.values[0]).toBeNull(); // jour sans portée : taux inconnu, pas zéro
  });

  it('la variation est un écart en points, pas un pourcentage', () => {
    const rows = [...both(5, 100, '2026-10-14'), ...both(10, 100, '2026-10-20')];
    const s = summarizeMetric(rows, 'engagementRate', new Set(['a']), w);
    expect(s).toMatchObject({ value: 0.1, previous: 0.05 });
    expect(s.change).toMatchObject({ unit: 'points', percent: null, direction: 'up' });
    expect(s.change!.diff).toBeCloseTo(0.05);
  });

  it('un écart sous 0,05 point est stable', () => {
    const rows = [...both(500, 10_000, '2026-10-14'), ...both(5_002, 100_000, '2026-10-20')];
    expect(summarizeMetric(rows, 'engagementRate', new Set(['a']), w).change?.direction).toBe('flat');
  });

  it('indisponible tant qu’il manque la portée ou les interactions', () => {
    expect(summarizeMetric([row('a', '2026-10-20', 'engagement', 5)], 'engagementRate', new Set(['a']), w).available).toBe(false);
    expect(summarizeMetric([row('a', '2026-10-20', 'reach', 5)], 'engagementRate', new Set(['a']), w).available).toBe(false);
    expect(summarizeMetric([], 'engagementRate', new Set(['a']), w).available).toBe(false);
  });

  it('disponible mais sans valeur quand la portée est nulle sur la période', () => {
    const s = summarizeMetric(both(5, 0, '2026-10-20'), 'engagementRate', new Set(['a']), w);
    expect(s).toMatchObject({ available: true, value: null, change: null });
  });

  it('les échecs sont une métrique d’activité : toujours disponible, zéro compris', () => {
    const s = summarizeMetric([row('a', '2026-10-20', 'failed', 2)], 'failed', new Set(['a']), w);
    expect(s).toMatchObject({ available: true, value: 2, previous: 0 });
    expect(summarizeMetric([], 'failed', new Set(['a']), w)).toMatchObject({ available: true, value: 0 });
  });
});

describe('tableau par canal, publications récentes, file de publication', () => {
  const w = periodWindows(7, TODAY);
  const rows = [row('a', '2026-10-20', 'published', 1), row('b', '2026-10-20', 'published', 4), row('b', '2026-10-21', 'failed', 2), row('a', '2026-10-05', 'published', 9)];

  it('trie selon la métrique choisie, du plus fort au plus faible, et garde les canaux à zéro pour une activité', () => {
    const t = performanceTable(rows, ['published', 'failed'], ['a', 'b', 'c'], 'published', w);
    expect(t.rows.map((r) => [r.integrationId, r.values.published, r.values.failed])).toEqual([['b', 4, 2], ['a', 1, 0], ['c', 0, 0]]);
  });

  it('un autre tri réordonne ; à égalité l’ordre des canaux est gardé', () => {
    const t = performanceTable(rows, ['published', 'failed'], ['a', 'b', 'c'], 'failed', w);
    expect(t.rows.map((r) => r.integrationId)).toEqual(['b', 'a', 'c']);
  });

  it('une audience absente donne null, classé en dernier ; le total tous canaux est la somme', () => {
    const data = [row('a', '2026-10-20', 'reach', 7), row('a', '2026-10-20', 'engagement', 1)];
    const t = performanceTable(data, ['reach', 'engagementRate'], ['a', 'b'], 'reach', w);
    expect(t.rows.map((r) => [r.integrationId, r.values.reach])).toEqual([['a', 7], ['b', null]]);
    expect(t.rows[0]!.values.engagementRate).toBeCloseTo(1 / 7);
    expect(t.total.reach).toBe(7);
    const all = performanceTable(rows, ['published'], ['a', 'b'], 'published', w);
    expect(all.total.published).toBe(5);
  });

  const post = (id: string, integrationId: string, at: string): RecentPost => ({ id, integrationId, content: id, at, url: null });
  it('publications récentes : du périmètre, de la période, de la plus récente à la plus ancienne, limitées', () => {
    const posts = [
      post('old', 'a', '2026-10-01T10:00:00Z'), post('mid', 'a', '2026-10-20T10:00:00Z'), post('new', 'b', '2026-10-24T23:59:00Z'),
      post('other', 'c', '2026-10-22T10:00:00Z'), post('bad', 'a', 'pas une date'), post('tomorrow', 'a', '2026-10-25T00:00:00Z'),
    ];
    expect(recentPosts(posts, new Set(['a', 'b']), w).map((p) => p.id)).toEqual(['new', 'mid']);
    expect(recentPosts(posts, new Set(['a']), w).map((p) => p.id)).toEqual(['mid']);
    expect(recentPosts(posts, new Set(['a', 'b', 'c']), w, 2).map((p) => p.id)).toEqual(['new', 'other']);
  });

  it('file : programmées et brouillons, pour le périmètre', () => {
    const queue = [{ integrationId: 'a', upcoming: 2, drafts: 1 }, { integrationId: 'b', upcoming: 3, drafts: 0 }];
    expect(queueSummary(queue, new Set(['a', 'b']))).toEqual({ upcoming: 5, drafts: 1 });
    expect(queueSummary(queue, new Set(['a']))).toEqual({ upcoming: 2, drafts: 1 });
  });
});

describe('la page entière (buildView)', () => {
  const channelIds = ['a', 'b'];
  const activity = [row('a', '2026-10-20', 'published', 3), row('b', '2026-10-21', 'published', 1), row('a', '2026-10-21', 'received', 6)];
  const state = { days: 7, metric: null, channel: null } as const;
  const data = (rows: DailyMetricRow[], extra: Partial<{ queue: { integrationId: string; upcoming: number; drafts: number }[]; recent: RecentPost[] }> = {}) => ({ rows, queue: [], recent: [], ...extra });

  it('sans statistique d’audience : seules les quatre cartes d’activité, métrique par défaut = publications', () => {
    const v = buildView({ data: data(activity), channelIds, state, today: TODAY });
    expect(v.audience).toBe(false);
    expect(v.cards.map((c) => c.id)).toEqual(['published', 'received', 'replies', 'failed']);
    expect(v.metric).toBe('published');
    expect(v.detail.summary.value).toBe(4);
  });

  it('avec de l’audience : huit cartes, abonnés par défaut', () => {
    const rows = [...activity, row('a', '2026-10-24', 'followers', 100), row('a', '2026-10-24', 'reach', 40), row('a', '2026-10-24', 'engagement', 5)];
    const v = buildView({ data: data(rows), channelIds, state, today: TODAY });
    expect(v.audience).toBe(true);
    expect(v.cards.map((c) => c.id)).toEqual(['followers', 'reach', 'engagement', 'engagementRate', 'published', 'received', 'replies', 'failed']);
    expect(v.metric).toBe('followers');
    expect(v.table.metrics).toEqual(v.cards.map((c) => c.id));
  });

  it('une métrique d’audience demandée sans audience retombe sur une carte affichée', () => {
    const v = buildView({ data: data(activity), channelIds, state: { ...state, metric: 'reach' }, today: TODAY });
    expect(v.metric).toBe('published');
  });

  it('une métrique demandée est respectée', () => {
    const v = buildView({ data: data(activity), channelIds, state: { ...state, metric: 'received' }, today: TODAY });
    expect(v.metric).toBe('received');
    expect(v.detail.summary.value).toBe(6);
  });

  it('un canal choisi restreint les cartes, la file et les publications ; le tableau garde tous les canaux', () => {
    const recent = [{ id: 'p1', integrationId: 'a', content: '', at: '2026-10-22T10:00:00Z', url: null }, { id: 'p2', integrationId: 'b', content: '', at: '2026-10-23T10:00:00Z', url: null }];
    const v = buildView({
      data: data(activity, { queue: [{ integrationId: 'a', upcoming: 1, drafts: 2 }, { integrationId: 'b', upcoming: 4, drafts: 0 }], recent }),
      channelIds, state: { ...state, channel: 'a' }, today: TODAY,
    });
    expect(v.channel).toBe('a');
    expect(v.cards[0]!.value).toBe(3);
    expect(v.queue).toEqual({ upcoming: 1, drafts: 2 });
    expect(v.recent.map((p) => p.id)).toEqual(['p1']);
    expect(v.table.rows.map((r) => r.integrationId)).toEqual(['a', 'b']);
  });

  it('un canal inconnu ou masqué est ignoré, et ses lignes ne comptent pas dans le total', () => {
    const rows = [...activity, row('ghost', '2026-10-22', 'published', 100)];
    const v = buildView({ data: data(rows), channelIds, state: { ...state, channel: 'ghost' }, today: TODAY });
    expect(v.channel).toBeNull();
    expect(v.detail.summary.value).toBe(4);
  });

  it('le total « tous les canaux » égale la somme des lignes du tableau', () => {
    const v = buildView({ data: data(activity), channelIds, state, today: TODAY });
    expect(v.table.rows.reduce((n, r) => n + (r.values.published ?? 0), 0)).toBe(v.detail.summary.value);
    expect(v.table.total.published).toBe(v.detail.summary.value);
  });

  it('aucun canal : rien à calculer, pas d’erreur', () => {
    const v = buildView({ data: data([]), channelIds: [], state, today: TODAY });
    expect(v.detail.summary.value).toBe(0);
    expect(v.table.rows).toEqual([]);
  });
});

describe('chiffres d’activité tirés des publications et des messages', () => {
  const window = { from: '2026-10-01', to: '2026-10-31' };

  it('compte publiées et échecs par canal et par jour (UTC), ignore le reste', () => {
    const rows = activityRows(
      [
        { integrationId: 'a', state: 'published', at: '2026-10-05T23:30:00+00:00' },
        { integrationId: 'a', state: 'published', at: '2026-10-05T01:00:00Z' },
        { integrationId: 'a', state: 'published', at: '2026-10-06T00:00:00Z' },
        { integrationId: 'b', state: 'error', at: '2026-10-05T10:00:00Z' },
        { integrationId: 'b', state: 'unknown', at: '2026-10-05T11:00:00Z' },
        { integrationId: 'b', state: 'queued', at: '2026-10-05T11:00:00Z' },
        { integrationId: 'b', state: 'draft', at: '2026-10-05T11:00:00Z' },
        { integrationId: 'a', state: 'published', at: '2026-09-30T23:59:59Z' }, // hors fenêtre
        { integrationId: 'a', state: 'published', at: 'pas une date' },
      ],
      [],
      window,
    );
    expect(rows).toEqual([
      row('a', '2026-10-05', 'published', 2), row('b', '2026-10-05', 'failed', 2), row('a', '2026-10-06', 'published', 1),
    ].sort((x, y) => x.day.localeCompare(y.day) || x.integrationId.localeCompare(y.integrationId) || x.metric.localeCompare(y.metric)));
  });

  it('messages reçus = entrants ; réponses = sortants envoyés seulement', () => {
    const rows = activityRows(
      [],
      [
        { integrationId: 'a', direction: 'in', deliveryStatus: 'received', at: '2026-10-10T08:00:00Z' },
        { integrationId: 'a', direction: 'in', deliveryStatus: 'received', at: '2026-10-10T09:00:00Z' },
        { integrationId: 'a', direction: 'out', deliveryStatus: 'sent', at: '2026-10-10T10:00:00Z' },
        { integrationId: 'a', direction: 'out', deliveryStatus: 'failed', at: '2026-10-10T10:05:00Z' },
        { integrationId: 'a', direction: 'out', deliveryStatus: 'queued', at: '2026-10-10T10:06:00Z' },
      ],
      window,
    );
    expect(rows).toEqual([row('a', '2026-10-10', 'received', 2), row('a', '2026-10-10', 'replies', 1)]);
  });

  it('file : brouillons, et programmées seulement dans les 7 prochains jours', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    const counts = queueCounts(
      [
        { integrationId: 'a', state: 'draft', at: null },
        { integrationId: 'a', state: 'queued', at: '2026-10-24T12:00:00Z' },
        { integrationId: 'a', state: 'publishing', at: '2026-10-25T00:00:00Z' },
        { integrationId: 'a', state: 'queued', at: '2026-10-31T11:59:59Z' },
        { integrationId: 'a', state: 'queued', at: '2026-10-31T12:00:00Z' }, // pile 7 jours : exclu
        { integrationId: 'a', state: 'queued', at: '2026-10-24T11:59:59Z' }, // passé
        { integrationId: 'b', state: 'published', at: '2026-10-25T00:00:00Z' },
      ],
      now,
    );
    expect(counts).toEqual([{ integrationId: 'a', upcoming: 3, drafts: 1 }]);
  });
});

describe('formats', () => {
  it('nombres courts à partir de 100 000', () => {
    expect(formatCount('en', 12_480)).toBe('12,480');
    expect(formatCount('en', 250_000)).toBe('250K');
    expect(formatCount('en', 1_250_000)).toBe('1.3M');
  });
  it('variation signée', () => {
    expect(formatChange('en', { diff: 20, percent: 0.2, direction: 'up' })).toBe('+20%');
    expect(formatChange('en', { diff: -3, percent: -0.034, direction: 'down' })).toBe('-3.4%');
    expect(formatChange('en', { diff: 5, percent: null, direction: 'up' })).toBe('+5');
    expect(formatChange('en', { diff: 0, percent: 0, direction: 'flat' })).toBe('0%');
    expect(formatChange('en', { diff: 0, percent: null, direction: 'flat' })).toBe('0');
    expect(formatChange('fr', { diff: 20, percent: 0.2, direction: 'up' })).toMatch(/^\+20\s%$/);
  });
  it('moyenne et écart', () => {
    expect(formatAverage('en', 0.714)).toBe('0.7');
    expect(formatAverage('en', 12.6)).toBe('13');
    expect(formatSigned('en', 212)).toBe('+212');
    expect(formatSigned('en', -4)).toBe('-4');
  });
  it('taux en pourcentage, nombre sinon', () => {
    expect(formatMetric('en', 'engagementRate', 0.0664)).toBe('6.6%');
    expect(formatMetric('en', 'followers', 17_391)).toBe('17,391');
  });
  it('jour avec l’année pour les bornes de période', () => {
    expect(formatDayYear('en', '2026-10-03')).toBe('Oct 3, 2026');
  });
  it('jour formaté en UTC, quel que soit le fuseau du serveur', () => {
    expect(formatDay('en', '2026-10-03')).toBe('Oct 3');
    expect(formatDay('fr', '2026-01-01')).toMatch(/^1\s?janv\.?$/);
  });
});

describe('tracés', () => {
  it('une série croissante monte vers le haut de la zone', () => {
    const { line } = linePaths([0, 5, 10], { width: 100, height: 20, pad: 0, fromZero: true });
    expect(line).toBe('M0 20 L50 10 L100 0');
  });
  it('coupe la ligne là où la valeur est inconnue', () => {
    const { line, area } = linePaths([1, 2, null, 4, 5], { width: 40, height: 10, pad: 0 });
    expect(line.match(/M/g)).toHaveLength(2);
    expect(area.match(/Z/g)).toHaveLength(2);
  });
  it('un compteur à zéro reste en bas, un niveau constant se pose au milieu', () => {
    expect(linePaths([0, 0, 0], { width: 10, height: 10, pad: 0, fromZero: true }).line).toBe('M0 10 L5 10 L10 10');
    expect(linePaths([7, 7], { width: 10, height: 10, pad: 0 }).line).toBe('M0 5 L10 5');
  });
  it('un seul point, ou aucun', () => {
    expect(linePaths([3], { width: 10, height: 10, pad: 0 }).line).toBe('M5 5 L5 5');
    expect(linePaths([null, null], { width: 10, height: 10 })).toEqual({ line: '', area: '' });
    expect(linePaths([], { width: 10, height: 10 })).toEqual({ line: '', area: '' });
  });
  it('hauteur des barres : nulle à zéro, 4 % au moins sinon, 100 % au maximum', () => {
    expect(barHeight(0, 10)).toBe(0);
    expect(barHeight(1, 1000)).toBe(4);
    expect(barHeight(10, 10)).toBe(100);
    expect(barHeight(5, 0)).toBe(0);
  });
});

describe('données de démonstration', () => {
  const w = periodWindows(90, TODAY);
  const channels = [{ id: 'i1', networkId: 'instagram' }, { id: 'i2', networkId: 'facebook' }, { id: 'i3', networkId: 'youtube' }];
  const rows = demoDailyRows(channels, { from: w.prevFrom, to: w.to });

  it('est identique d’un appel à l’autre (aucun alea)', () => {
    expect(demoDailyRows(channels, { from: w.prevFrom, to: w.to })).toEqual(rows);
  });

  it('un jour a la même valeur quelle que soit la fenêtre demandée', () => {
    const short = demoDailyRows(channels, { from: '2026-10-20', to: '2026-10-22' });
    const key = (r: DailyMetricRow) => `${r.integrationId}|${r.day}|${r.metric}`;
    const full = new Map(rows.map((r) => [key(r), r.value]));
    for (const r of short) expect(full.get(key(r))).toBe(r.value);
  });

  it('une ligne par canal, jour et métrique, toutes des entiers positifs ou nuls', () => {
    expect(rows).toHaveLength(channels.length * 180 * 7);
    expect(new Set(rows.map((r) => `${r.integrationId}|${r.day}|${r.metric}`)).size).toBe(rows.length);
    for (const r of rows) {
      expect(Number.isInteger(r.value) && r.value >= 0).toBe(true);
    }
  });

  it('donne une audience et de l’activité exploitables, avec des abonnés en hausse', () => {
    const v = buildView({ data: { rows, queue: [], recent: [] }, channelIds: ['i1', 'i2', 'i3'], state: { days: 30, metric: null, channel: null }, today: TODAY });
    expect(v.audience).toBe(true);
    expect(v.cards).toHaveLength(8);
    for (const c of v.cards) {
      expect(c.available).toBe(true);
      if (c.id !== 'failed') expect(c.value).toBeGreaterThan(0); // les échecs peuvent n'avoir aucun jour sur 30
    }
    expect(v.cards.find((c) => c.id === 'engagementRate')!.value).toBeLessThan(1);
    expect(v.cards[0]!.change?.direction).toBe('up');
  });

  it('un canal ajouté pendant la démo (réseau sans profil) a lui aussi des chiffres', () => {
    const extra = demoDailyRows([{ id: 'new-1', networkId: 'tiktok' }, { id: 'new-2', networkId: 'unknown-net' }], { from: '2026-10-01', to: '2026-10-05' });
    expect(extra.filter((r) => r.integrationId === 'new-2' && r.metric === 'followers').every((r) => r.value > 0)).toBe(true);
  });
});

describe('relevés d’audience lus en base', () => {
  it('convertit les lignes de channel_metrics_daily, bigint en texte compris', () => {
    expect(metricRowsFromDb([
      { integration_id: 'a', day: '2026-10-24', metric: 'followers', value: 5130 },
      { integration_id: 'a', day: '2026-10-23', metric: 'reach', value: '1200' },
      { integration_id: 'b', day: '2026-10-23T00:00:00+00:00', metric: 'engagement', value: 0 },
    ])).toEqual([
      row('a', '2026-10-24', 'followers', 5130), row('a', '2026-10-23', 'reach', 1200), row('b', '2026-10-23', 'engagement', 0),
    ]);
  });

  it('ignore une ligne illisible plutôt que de la lire comme zéro', () => {
    expect(metricRowsFromDb([
      { integration_id: 1, day: '2026-10-24', metric: 'reach', value: 1 },
      { integration_id: 'a', day: 'hier', metric: 'reach', value: 1 },
      { integration_id: 'a', day: '2026-10-24', metric: 'revenue', value: 1 },
      { integration_id: 'a', day: '2026-10-24', metric: 'reach', value: -1 },
      { integration_id: 'a', day: '2026-10-24', metric: 'reach', value: 'abc' },
      { integration_id: 'a', day: '2026-10-24', metric: 'reach', value: '' },
      { integration_id: 'a', day: '2026-10-24', metric: 'reach', value: null },
      { integration_id: 'a', day: '2026-10-24', metric: 'failed', value: 3 }, // l'activité se calcule, elle n'est pas stockée ici
    ])).toEqual([]);
  });

  it('des relevés d’audience font apparaître les huit cartes, calculées comme les autres', () => {
    const rows = metricRowsFromDb([
      { integration_id: 'a', day: '2026-10-17', metric: 'followers', value: 1000 },
      { integration_id: 'a', day: '2026-10-24', metric: 'followers', value: 1040 },
      { integration_id: 'a', day: '2026-10-20', metric: 'reach', value: 400 },
      { integration_id: 'a', day: '2026-10-20', metric: 'engagement', value: 20 },
    ]);
    const v = buildView({ data: { rows, queue: [], recent: [] }, channelIds: ['a'], state: { days: 7, metric: null, channel: null }, today: TODAY });
    expect(v.audience).toBe(true);
    expect(v.cards.find((c) => c.id === 'followers')).toMatchObject({ value: 1040, previous: 1000 });
    expect(v.cards.find((c) => c.id === 'engagementRate')).toMatchObject({ available: true, value: 0.05 });
  });
});

describe('canaux à reconnecter pour les statistiques', () => {
  const base = { rows: [] as DailyMetricRow[], queue: [], recent: [] };
  const state = { days: 7, metric: null, channel: null } as const;

  it('liste les canaux affichés dont la collecte attend une autorisation, dans l’ordre des canaux', () => {
    const v = buildView({
      data: { ...base, collection: [{ integrationId: 'b', status: 'missing_scope' }, { integrationId: 'a', status: 'missing_scope' }, { integrationId: 'c', status: 'ok' }, { integrationId: 'ghost', status: 'missing_scope' }] },
      channelIds: ['a', 'b', 'c'], state, today: TODAY,
    });
    expect(v.reconnect).toEqual(['a', 'b']);
  });

  it('une panne passagère, une collecte en attente ou l’absence d’information ne demandent rien', () => {
    expect(buildView({ data: { ...base, collection: [{ integrationId: 'a', status: 'error' }, { integrationId: 'a', status: 'pending' }] }, channelIds: ['a'], state, today: TODAY }).reconnect).toEqual([]);
    expect(buildView({ data: base, channelIds: ['a'], state, today: TODAY }).reconnect).toEqual([]);
  });
});
