'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Recharge la page toutes les `seconds` secondes, `times` fois au plus : le temps que le fournisseur confirme le paiement. */
export function AutoRefresh({ seconds = 5, times = 24 }: { seconds?: number; times?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      if (++n > times) clearInterval(id);
      else router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds, times]);
  return null;
}
