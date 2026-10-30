'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { supportUnreadAction } from '@/app/app/(shell)/support/actions';
import { NavIcon } from '@/components/app/nav-icons';
import { useT } from '@/i18n/client';
import { SUPPORT_UNREAD_EVENT } from './events';
import { useRealtimeTable } from './use-realtime-table';

/** Bouton « Support » de l'en-tête : ouvre le chat, avec le nombre de réponses non lues. Se met à jour en direct (Realtime), à défaut toutes les minutes. */
export function SupportLink({ unread: initial, userId, realtime }: { unread: number; userId: string; realtime: boolean }) {
  const t = useT();
  const [unread, setUnread] = useState(initial);
  useEffect(() => setUnread(initial), [initial]);

  const refresh = useCallback(async () => {
    const n = await supportUnreadAction().catch(() => null);
    if (n !== null) setUnread(n);
  }, []);

  const connected = useRealtimeTable({ enabled: realtime, name: 'support-unread', table: 'support_conversations', filter: `user_id=eq.${userId}`, onChange: () => void refresh() });

  useEffect(() => {
    const onEvent = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') setUnread(n);
    };
    window.addEventListener(SUPPORT_UNREAD_EVENT, onEvent);
    return () => window.removeEventListener(SUPPORT_UNREAD_EVENT, onEvent);
  }, []);

  useEffect(() => {
    // Hors démonstration seulement : en démonstration, rien ne change côté serveur tant que la page ne le demande pas.
    if (!realtime) return;
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const id = window.setInterval(tick, connected ? 5 * 60_000 : 60_000);
    return () => window.clearInterval(id);
  }, [realtime, connected, refresh]);

  const label = unread > 0 ? t('app.support.linkUnread', { count: unread }) : t('app.support.link');
  return (
    <Link href="/app/support" aria-label={label} title={t('app.support.link')} className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink/70 hover:bg-wash hover:text-ink">
      <NavIcon name="support" size={20} />
      {unread > 0 && <span className="absolute top-1.5 end-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-lime px-1 text-[10px] font-bold text-ink ring-2 ring-surface">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}
