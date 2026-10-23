import { formatShortDate } from '@/i18n/format';
import type { T } from '@/i18n/types';

/** Inscriptions par jour : une barre par jour, du plus ancien au plus récent. Sans bibliothèque, lisible au toucher comme au clavier. */
export function SignupsChart({ days, t }: { days: { day: string; count: number }[]; t: T }) {
  const total = days.reduce((n, d) => n + d.count, 0);
  const max = Math.max(1, ...days.map((d) => d.count));
  const date = (day: string) => formatShortDate(t.locale, new Date(`${day}T00:00:00Z`));
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <div>
      <div role="img" aria-label={t('admin.signups.label', { total })} className="flex h-52 items-end gap-[3px]">
        {days.map((d) => (
          <div key={d.day} title={t('admin.signups.bar', { date: date(d.day), count: d.count })} className="flex h-full flex-1 items-end">
            <span
              className={`block w-full rounded-t-[3px] ${d.count > 0 ? 'bg-forest-2' : 'bg-line'}`}
              style={{ height: d.count > 0 ? `${Math.max(6, (d.count / max) * 100)}%` : '2px' }}
            />
          </div>
        ))}
      </div>
      {first && last && (
        <div className="mt-2 flex justify-between text-xs text-subtle" aria-hidden="true">
          <span>{date(first.day)}</span>
          <span>{date(last.day)}</span>
        </div>
      )}
    </div>
  );
}
