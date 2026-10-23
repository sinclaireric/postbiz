import Link from 'next/link';
import type { T } from '@/i18n/types';
import { PHASES, type ListQuery } from '@/lib/admin/types';

/** Recherche et filtre de statut : un formulaire GET, donc des adresses qu'on peut partager et aucun script. */
export function ListFilters({ action, query, placeholder, t, phaseSelect = true }: { action: string; query: ListQuery; placeholder: string; t: T; /** Faux quand la page a déjà ses propres puces de statut : le filtre en cours est alors conservé tel quel. */ phaseSelect?: boolean }) {
  const field = 'h-11 rounded-full border border-line bg-surface px-4 text-[15px] outline-none focus:border-ink focus:ring-4 focus:ring-lime/40';
  const active = Boolean(query.search || query.phase);
  return (
    <form action={action} method="get" role="search" className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-muted sm:min-w-64">
        {t('admin.filter.search')}
        <input type="search" name="q" defaultValue={query.search} placeholder={placeholder} maxLength={100} className={field} />
      </label>
      {phaseSelect ? (
        <label className="grid gap-1 text-xs font-semibold text-muted">
          {t('admin.filter.phase')}
          <select name="phase" defaultValue={query.phase ?? ''} className={`${field} pe-8`}>
            <option value="">{t('admin.filter.allPhases')}</option>
            {PHASES.map((p) => <option key={p} value={p}>{t(`admin.phase.${p}`)}</option>)}
          </select>
        </label>
      ) : query.phase ? <input type="hidden" name="phase" value={query.phase} /> : null}
      <button type="submit" className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-[15px] font-semibold text-white hover:bg-black/80">{t('admin.filter.submit')}</button>
      {active && <Link href={action} className="inline-flex h-11 items-center px-2 text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink">{t('admin.filter.reset')}</Link>}
    </form>
  );
}
