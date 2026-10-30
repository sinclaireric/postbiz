'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Écoute les changements d'une table par Supabase Realtime (la RLS décide de ce que la personne reçoit) et appelle `onChange` à chaque événement ;
 * rend vrai tant que l'abonnement est établi. Quand il ne l'est pas (hors connexion, Realtime indisponible), l'appelant interroge la base à intervalle court :
 * rien ne dépend du temps réel pour être correct.
 */
export function useRealtimeTable({ enabled, name, table, filter, onChange }: { enabled: boolean; name: string; table: string; filter: string; onChange: () => void }): boolean {
  const [connected, setConnected] = useState(false);
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });

  useEffect(() => {
    if (!enabled) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => callback.current())
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));
    return () => {
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [enabled, name, table, filter]);

  return connected;
}
