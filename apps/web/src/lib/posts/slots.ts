/** Heures (locales) auxquelles l'application propose de publier : matin, midi, fin de journée. */
export const SLOT_HOURS = [9, 12, 18] as const;
/** Un créneau doit être au moins à cette distance : le serveur refuse une publication trop proche (MIN_LEAD_MS) et laisse le temps de relire. */
const LEAD_MS = 30 * 60_000;

/** Prochain créneau libre : le premier de la journée assez éloigné, sinon le premier du lendemain. */
export function nextSlot(now: Date): Date {
  for (const hour of SLOT_HOURS) {
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0);
    if (slot.getTime() >= now.getTime() + LEAD_MS) return slot;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, SLOT_HOURS[0], 0);
}

export const tomorrowMorning = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, SLOT_HOURS[0], 0);

/** Dans une heure, arrondi aux 5 minutes supérieures. */
export function inOneHour(now: Date): Date {
  const t = new Date(now.getTime() + 3_600_000);
  t.setSeconds(0, 0);
  t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5);
  return t;
}
