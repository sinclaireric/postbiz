'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { setRegionAction } from '@/app/actions/region';
import { useT } from '@/i18n/client';
import { LOCALE_META } from '@/i18n/config';
import { SELECTABLE_COUNTRIES, WORLD } from '@/lib/billing/region';

/** Choix du pays, qui fixe la monnaie des prix. Le pays détecté est présélectionné ; tout autre pays que ceux de la liste donne les prix en dollars. */
export function RegionSelect({ country, id = 'region' }: { country: string | null; id?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const names = useMemo(() => {
    const dn = new Intl.DisplayNames(LOCALE_META[t.locale].tag, { type: 'region' });
    return SELECTABLE_COUNTRIES.map((c) => ({ code: c, name: dn.of(c) ?? c })).sort((a, b) => a.name.localeCompare(b.name, LOCALE_META[t.locale].tag));
  }, [t.locale]);
  const value = country && SELECTABLE_COUNTRIES.includes(country) ? country : WORLD;

  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium text-muted">{t('pricing.region.label')}</label>
      <select
        id={id}
        value={value}
        disabled={pending}
        onChange={(e) => start(async () => { await setRegionAction(e.target.value); router.refresh(); })}
        className="h-10 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink"
      >
        {names.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
        <option value={WORLD}>{t('pricing.region.other')}</option>
      </select>
    </span>
  );
}
