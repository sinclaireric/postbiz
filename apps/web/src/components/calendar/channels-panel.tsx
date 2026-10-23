'use client';

import Link from 'next/link';
import { Badge, ButtonLink } from '@/components/ui';
import { useT } from '@/i18n/client';
import { networkName } from '@/lib/networks';
import type { IntegrationItem } from '@/lib/data/types';
import { ChannelAvatar } from './channel-avatar';

function EmptyIllustration() {
  return (
    <svg width="150" height="110" viewBox="0 0 150 110" fill="none" aria-hidden="true">
      <rect x="14" y="30" width="50" height="50" rx="14" fill="#e1306c" transform="rotate(-10 14 30)" opacity="0.9" />
      <rect x="86" y="22" width="46" height="46" rx="14" fill="#1877f2" transform="rotate(9 86 22)" opacity="0.9" />
      <rect x="45" y="42" width="60" height="60" rx="18" fill="#111110" />
      <path d="M75 62v20M65 72h20" stroke="#c6f432" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** Pastille de « Tous les canaux » : les canaux empilés. */
function AllChannelsIcon({ integrations }: { integrations: IntegrationItem[] }) {
  const shown = integrations.slice(0, 3);
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">
      <span className="flex -space-x-3">
        {shown.map((i) => <ChannelAvatar key={i.id} channel={i} size={22} badge={false} />)}
      </span>
    </span>
  );
}

const row = (on: boolean) => `flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${on ? 'bg-wash ring-1 ring-ink/15' : 'hover:bg-wash'}`;

/**
 * Canaux connectés. Un clic sur un canal n'affiche que ses publications dans le calendrier ; « Tous les canaux » (ou un second clic sur le canal choisi)
 * remet tout.
 */
export function ChannelsPanel({ integrations, canWrite, selectedId, onSelect }: { integrations: IntegrationItem[]; canWrite: boolean; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <ButtonLink href="/app/canaux" variant="secondary" size="md" className="w-full justify-start">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
        {t('app.channelsPanel.add')}
      </ButtonLink>

      {integrations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-2 py-10 text-center">
          <EmptyIllustration />
          <p className="mt-5 text-lg font-semibold tracking-tight">{t('app.channelsPanel.emptyTitle')}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t('app.channelsPanel.emptyText')}</p>
        </div>
      ) : (
        <>
          <ul className="mt-4 grid gap-1.5" aria-label={t('app.channelsPanel.connected')}>
            {integrations.length > 1 && (
              <li>
                <button type="button" onClick={() => onSelect(null)} aria-pressed={selectedId === null} className={row(selectedId === null)}>
                  <AllChannelsIcon integrations={integrations} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t('app.channelsPanel.all')}</span>
                </button>
              </li>
            )}
            {integrations.map((i) => {
              const on = selectedId === i.id;
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => onSelect(on ? null : i.id)} aria-pressed={on} className={row(on)}>
                    <ChannelAvatar channel={i} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{i.name}</span>
                      <span className="block truncate text-xs text-muted">{networkName(i.networkId)}</span>
                    </span>
                    {i.status !== 'active' && <Badge tone="warn">{i.status === 'refresh_needed' ? t('app.channelsPanel.reconnect') : t('app.channelsPanel.disabled')}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
          {integrations.length > 1 && <p className="mt-3 px-2.5 text-xs text-subtle">{t('app.channelsPanel.filterHint')}</p>}
        </>
      )}
      {!canWrite && <p className="mt-4 text-xs text-subtle">{t('app.channelsPanel.viewerNote')}</p>}
      <p className="mt-auto pt-4 text-xs text-subtle"><Link href="/app/canaux" className="underline underline-offset-4">{t('app.channelsPanel.manage')}</Link></p>
    </div>
  );
}
