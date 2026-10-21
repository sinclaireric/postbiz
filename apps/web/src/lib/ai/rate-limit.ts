/**
 * Limite d'appels en mémoire : au plus `max` appels par fenêtre glissante et par clé (l'utilisateur). L'assistant est facturé à l'usage :
 * cette limite évite qu'une boucle ou un abus vide le crédit. Elle vaut par processus ; derrière plusieurs instances, la limite
 * réelle est un multiple (à remplacer par un compteur en base le jour où l'application est répartie sur plusieurs serveurs).
 */
export function createLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    /** Enregistre un appel et renvoie true s'il est permis. */
    take(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5_000) for (const [k, v] of hits) if (v.every((at) => t - at >= windowMs)) hits.delete(k);
      return true;
    },
  };
}

const TEN_MINUTES = 10 * 60_000;
/** Rédiger et améliorer : appels courts. */
export const assistLimiter = createLimiter(30, TEN_MINUTES);
/** Idées (recherche web + rédaction) : bien plus coûteuses. */
export const ideasLimiter = createLimiter(6, TEN_MINUTES);
