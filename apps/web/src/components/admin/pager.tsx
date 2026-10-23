import Link from 'next/link';
import type { T } from '@/i18n/types';

const link = 'inline-flex h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold transition-colors hover:bg-wash';
const off = 'inline-flex h-9 items-center rounded-full border border-line px-4 text-sm font-semibold text-subtle';

/** Précédent / suivant : `href(page)` construit l'adresse de chaque page en gardant les filtres. */
export function Pager({ page, pages, href, t }: { page: number; pages: number; href: (page: number) => string; t: T }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('admin.pager.label')} className="mt-5 flex items-center justify-between gap-3">
      {page > 1 ? <Link href={href(page - 1)} className={link} rel="prev">{t('admin.pager.previous')}</Link> : <span className={off} aria-disabled="true">{t('admin.pager.previous')}</span>}
      <span className="text-sm text-muted">{t('admin.pager.page', { page, pages })}</span>
      {page < pages ? <Link href={href(page + 1)} className={link} rel="next">{t('admin.pager.next')}</Link> : <span className={off} aria-disabled="true">{t('admin.pager.next')}</span>}
    </nav>
  );
}
