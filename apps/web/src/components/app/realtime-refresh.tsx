'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Rafraîchit la page quand un message ou une conversation de l'organisation change (Supabase Realtime).
 * La RLS s'applique aussi au temps réel : un utilisateur ne reçoit que les changements de ses organisations.
 */
export function RealtimeRefresh({ orgId, tables = ['messages', 'conversations'] }: { orgId: string; tables?: string[] }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };

    let channel = supabase.channel(`org-${orgId}-${tables.join('-')}`);
    for (const table of tables) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `org_id=eq.${orgId}` }, refresh);
    }
    channel.subscribe();

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [orgId, router, tables]);

  return null;
}
