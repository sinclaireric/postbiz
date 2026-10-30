'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Recharge les données de la page à intervalle régulier tant que l'onglet est visible (et dès qu'il le redevient). Ne rend rien. */
export function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') router.refresh(); };
    const id = window.setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [router, everyMs]);
  return null;
}
