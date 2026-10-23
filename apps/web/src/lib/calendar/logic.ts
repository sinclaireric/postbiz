// Calendrier : fonctions pures sur des dates en heure LOCALE (le fuseau du navigateur), testables sans DOM.
import type { PostItem } from '@/lib/data/types';

export type CalendarView = 'day' | 'week' | 'month';

const p2 = (n: number) => String(n).padStart(2, '0');

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Ajoute des jours calendaires (sûr au changement d'heure : on ne passe pas par des millisecondes). */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** Lundi de la semaine de `d` (semaines françaises). */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const offset = (day.getDay() + 6) % 7; // lundi = 0
  return addDays(day, -offset);
}

export const weekDays = (anchor: Date): Date[] => {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
};

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Semaines entières (lundi → dimanche) couvrant le mois de `anchor` : 5 ou 6 lignes de 7 jours. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  // Mois : on garde le jour 1 pour éviter qu'un 31 saute un mois.
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

const dmy = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

export function rangeLabel(view: CalendarView, anchor: Date, localeTag = 'fr'): string {
  if (view === 'day') return dmy(anchor);
  if (view === 'week') {
    const days = weekDays(anchor);
    return `${dmy(days[0]!)} - ${dmy(days[6]!)}`;
  }
  return anchor.toLocaleDateString(localeTag, { month: 'long', year: 'numeric' });
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const slotKey = (d: Date) => `${dayKey(d)}T${p2(d.getHours())}`;

/** Valeur d'un champ <input type="datetime-local"> (heure locale, sans fuseau). */
export const toLocalInputValue = (d: Date) => `${dayKey(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

export const slotStart = (day: Date, hour: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0);

/** Une heure entièrement passée n'est plus sélectionnable ; l'heure en cours l'est encore. */
export const isPastSlot = (start: Date, now: Date) => start.getTime() + 3_600_000 <= now.getTime();

/** Une date de publication par défaut quand on clique sur un jour du mois : 9 h, ou la prochaine heure pleine si on est déjà passé. */
export function defaultTimeForDay(day: Date, now: Date): Date {
  const nine = slotStart(day, 9);
  if (nine.getTime() > now.getTime()) return nine;
  if (!sameDay(day, now)) return nine;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
  return sameDay(next, now) ? next : nine;
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}

/** Les publications datées, regroupées par créneau horaire ou par jour (heure locale). */
/**
 * Publications d'un seul canal (filtre du panneau des canaux). Sans canal choisi, ou si le canal choisi n'existe plus parmi les canaux connus,
 * on garde tout : un filtre périmé ne doit jamais laisser un calendrier vide.
 */
export function filterByChannel(posts: PostItem[], channelId: string | null, knownChannelIds: readonly string[]): PostItem[] {
  if (!channelId || !knownChannelIds.includes(channelId)) return posts;
  return posts.filter((p) => p.integrationId === channelId);
}

export function groupPosts(posts: PostItem[], by: 'slot' | 'day'): Map<string, PostItem[]> {
  const dated = posts.filter((p) => p.publishAt).sort((a, b) => a.publishAt!.localeCompare(b.publishAt!));
  return groupBy(dated, (p) => (by === 'slot' ? slotKey(new Date(p.publishAt!)) : dayKey(new Date(p.publishAt!))));
}

export const HOURS = Array.from({ length: 24 }, (_, h) => h);
