'use client';

import { useState } from 'react';
import { Lightbox, MediaThumb } from '@/components/media/media-thumb';
import { useT } from '@/i18n/client';
import type { AgentMedia } from '@/lib/agent/types';

/** Les images que l'agent a générées dans un message : déjà dans la médiathèque. Un clic ouvre l'image en grand. */
export function GeneratedImages({ items }: { items: AgentMedia[] }) {
  const t = useT();
  const [viewing, setViewing] = useState<AgentMedia | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <ul className="mt-3 flex flex-wrap gap-2.5" aria-label={t('app.agent.generated.label')}>
        {items.map((m) => (
          <li key={m.id}>
            <button
              type="button" onClick={() => setViewing(m)} aria-label={t('app.agent.generated.open', { name: m.name })} title={m.name}
              className="block h-40 w-40 overflow-hidden rounded-2xl border border-line transition hover:border-ink focus-visible:ring-4 focus-visible:ring-lime/40 sm:h-44 sm:w-44"
            ><MediaThumb item={m} showDuration={false} /></button>
          </li>
        ))}
      </ul>
      {viewing && <Lightbox item={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
