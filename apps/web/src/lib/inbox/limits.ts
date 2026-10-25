import { createLimiter } from '@/lib/ai/rate-limit';

/**
 * Suggestions de réponse : chacune est facturée à l'usage. Plafond par organisation et par jour (`SUGGESTIONS_PER_DAY`, 200 par défaut ; 0 les désactive),
 * et plafond par utilisateur sur dix minutes contre une boucle ou un abus.
 */
export const suggestionsPerDay = (): number => {
  const n = Number.parseInt(process.env.SUGGESTIONS_PER_DAY?.trim() ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 200;
};

export const suggestLimiter = createLimiter(30, 10 * 60_000);
