'use client';

import { BillingText } from '@/components/billing-text';

/** Le plafond atteint (le message dit lequel), avec le lien vers les offres quand une offre supérieure le relèverait. */
export function LimitNote({ message, upgradable }: { message: string; upgradable: boolean }) {
  return (
    <p role="status" className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
      {message}
      {upgradable && <>{' '}<BillingText k="app.knowledgePage.upgrade" /></>}
    </p>
  );
}
