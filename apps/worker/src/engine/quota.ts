// Report automatique d'une publication refusée parce que le quota du réseau est épuisé.

/** Une publication est tentée 3 fois au plus (la première, puis deux reports) : au-delà, elle reste en erreur et l'utilisateur décide. */
export const MAX_QUOTA_TRIES = 3;

/** Marge après le renouvellement du quota : on ne repart pas à la seconde près. */
export const QUOTA_MARGIN_MS = 10 * 60_000;

const PACIFIC = 'America/Los_Angeles';

/** Heure locale du Pacifique d'un instant, lue comme si elle était en UTC (pour mesurer le décalage, heure d'été comprise). */
function pacificAsUtc(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
}

/**
 * Prochain minuit sur la côte Pacifique des États-Unis : le quota de l'API YouTube se renouvelle à cet instant (8 h UTC l'hiver, 7 h UTC l'été).
 * Calculé avec les règles de fuseau du système, donc correct aussi les nuits de changement d'heure.
 */
export function nextPacificMidnight(now: Date): Date {
  const nowSeconds = Math.floor(now.getTime() / 1000) * 1000;
  const local = new Date(pacificAsUtc(now));
  const targetLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 0, 0, 0);
  // Le décalage peut changer entre maintenant et minuit (changement d'heure la nuit) : on l'ajuste une fois sur l'instant trouvé.
  let guess = targetLocal - (pacificAsUtc(now) - nowSeconds);
  guess = targetLocal - (pacificAsUtc(new Date(guess)) - guess);
  return new Date(guess);
}

/** « 25/10/2026 07:10 UTC » : l'heure du report dans un message (le worker ne connaît pas le fuseau de l'utilisateur). */
export function formatUtc(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(at.getUTCDate())}/${p(at.getUTCMonth() + 1)}/${at.getUTCFullYear()} ${p(at.getUTCHours())}:${p(at.getUTCMinutes())} UTC`;
}
