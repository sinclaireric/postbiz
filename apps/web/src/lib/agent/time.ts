/**
 * Dates de l'agent. L'agent raisonne en heure locale de l'utilisateur (« demain 9 h ») ; l'application stocke de l'UTC.
 * Le fuseau vient du navigateur ; il est vérifié avant tout usage, car il arrive dans une requête.
 */

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const get = (type: string) => Number(f.formatToParts(new Date(ms)).find((p) => p.type === type)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

/** Décalage du fuseau par rapport à l'UTC à cet instant, en millisecondes (positif à l'est de Greenwich). */
function offsetMs(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Heure murale d'un instant dans un fuseau, au format `YYYY-MM-DDTHH:mm`. */
export function utcToLocal(iso: string | Date, timeZone: string): string {
  const ms = (iso instanceof Date ? iso : new Date(iso)).getTime();
  const p = parts(ms, timeZone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/**
 * Heure murale `YYYY-MM-DDTHH:mm` d'un fuseau → instant UTC (ISO), ou null si le texte n'est pas une date valide.
 * Deux passes pour tomber juste autour d'un changement d'heure ; une heure qui n'existe pas (saut du printemps) est décalée d'une heure.
 */
export function localToUtc(local: string, timeZone: string): string | null {
  const m = LOCAL.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null; // 31 février, etc.
  const first = wall - offsetMs(wall, timeZone);
  const second = wall - offsetMs(first, timeZone);
  return new Date(second).toISOString();
}

/** « Tuesday 2026-10-27 14:05 » : le jour de la semaine aide le modèle à résoudre « vendredi prochain ». */
export function describeNow(now: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now);
  return `${weekday} ${utcToLocal(now, timeZone).replace('T', ' ')}`;
}
