import { useEffect, useState } from "react";

/** Horloge qui se met à jour chaque minute : sert aux compteurs de fenêtre de réponse et aux dates relatives. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
