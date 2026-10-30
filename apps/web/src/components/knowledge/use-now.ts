'use client';

import { useEffect, useState } from 'react';

/**
 * L'heure du navigateur, connue seulement une fois la page affichée (null avant) : un texte qui en dépend (« lu il y a 5 min ») n'est jamais écrit par le serveur, qui n'a
 * ni le même fuseau ni la même seconde, et la page s'hydrate sans écart. Elle se remet à jour toutes les 30 secondes, pour que « il y a 1 minute » ne reste pas figé.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
