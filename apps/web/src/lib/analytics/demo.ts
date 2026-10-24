import { dayRange } from './logic';
import type { DailyMetric, DailyMetricRow, DayWindow } from './types';

// Statistiques d'exemple du mode démo. Ce ne sont PAS des mesures : les chiffres sortent d'une formule déterministe (aucun alea, donc la
// même page à chaque visite et les mêmes totaux quelle que soit la période affichée). Rien de ceci n'est utilisé avec un vrai compte.

/** Niveau typique d'un canal : abonnés au départ, croissance par jour, et débit quotidien moyen des autres métriques. */
interface Profile {
  followers: number;
  growth: number;
  reach: number;
  engagement: number;
  published: number;
  received: number;
  replies: number;
  failed: number;
}

const PROFILES: Record<string, Profile> = {
  instagram: { followers: 8420, growth: 9, reach: 2600, engagement: 190, published: 0.7, received: 2.2, replies: 1.8, failed: 0.02 },
  facebook: { followers: 5130, growth: 4, reach: 1400, engagement: 85, published: 0.5, received: 1.4, replies: 1.1, failed: 0.04 },
  youtube: { followers: 1960, growth: 3, reach: 900, engagement: 60, published: 0.15, received: 0.8, replies: 0.5, failed: 0.01 },
  linkedin: { followers: 2310, growth: 5, reach: 700, engagement: 55, published: 0.3, received: 0.4, replies: 0.3, failed: 0.01 },
  x: { followers: 3480, growth: 2, reach: 1900, engagement: 120, published: 0.6, received: 1, replies: 0.7, failed: 0.02 },
  tiktok: { followers: 6200, growth: 14, reach: 5200, engagement: 410, published: 0.2, received: 1.3, replies: 0.6, failed: 0.01 },
};
const FALLBACK: Profile = PROFILES.facebook!;

/** Nombre pseudo-aléatoire stable dans [0, 1[ pour (canal, jour, métrique) : mulberry32 sur une empreinte de la clé. */
function unit(key: string): number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const EPOCH = Date.parse('2026-01-01T00:00:00Z');
const dayNumber = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - EPOCH) / 86_400_000);
const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());

/** Valeur entière d'un débit moyen `rate` ce jour-là : tirage stable, arrondi tiré au sort pour que 0,7 par jour donne bien ~0,7 en moyenne. */
const count = (rate: number, key: string): number => Math.floor(rate * (0.4 + 1.2 * unit(`${key}|a`)) + unit(`${key}|b`));

export function demoDailyRows(channels: readonly { id: string; networkId: string }[], window: DayWindow): DailyMetricRow[] {
  const rows: DailyMetricRow[] = [];
  for (const ch of channels) {
    const p = PROFILES[ch.networkId] ?? FALLBACK;
    // Les canaux d'exemple ajoutés pendant l'onboarding ont chacun leur échelle, tirée de leur identifiant.
    const scale = PROFILES[ch.networkId] ? 1 : 0.6 + 0.8 * unit(ch.id);
    for (const day of dayRange(window.from, window.to)) {
      const key = `${ch.id}|${day}`;
      const n = dayNumber(day);
      const weekday = isWeekend(day) ? 0.7 : 1.1;
      const put = (metric: DailyMetric, value: number) => rows.push({ integrationId: ch.id, day, metric, value: Math.max(0, Math.round(value)) });
      // Abonnés : une pente régulière et un léger balancement, jamais une chute brutale.
      put('followers', (p.followers + p.growth * n * 0.4) * scale + 6 * Math.sin(n / 4 + unit(ch.id) * 6));
      put('reach', p.reach * scale * weekday * (0.55 + 0.9 * unit(`${key}|reach`)));
      put('engagement', p.engagement * scale * weekday * (0.5 + 1 * unit(`${key}|eng`)));
      put('published', count(p.published * scale * weekday, `${key}|pub`));
      put('received', count(p.received * scale * weekday, `${key}|rec`));
      put('replies', count(p.replies * scale * weekday, `${key}|rep`));
      put('failed', unit(`${key}|fail`) < p.failed ? 1 : 0);
    }
  }
  return rows;
}

