import Link from 'next/link';
import { buttonClass } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { KnowledgeBrief } from '@/lib/data/types';

/** L'onglet « Ma base » du panneau IA : ce que la base contient en bref, et le lien vers la page où on la gère. */
export function KnowledgeSummary({ items }: { items: KnowledgeBrief[] }) {
  const t = useT();
  const pinned = items.filter((i) => i.pinned).length;
  return (
    <div className="grid gap-4">
      <p className="text-sm leading-relaxed text-muted">{t('app.ai.base.intro')}</p>
      <p className="text-sm font-semibold">{t('app.ai.base.stats', { pinned, search: items.length - pinned })}</p>
      <div>
        <Link href="/app/connaissances" className={buttonClass('secondary', 'sm')}>{t('app.ai.base.manage')}</Link>
      </div>
      <p className="text-xs text-subtle">{t('app.ai.privacy')}</p>
    </div>
  );
}
