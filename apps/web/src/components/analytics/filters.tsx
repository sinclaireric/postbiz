import Link from 'next/link';
import { ChannelAvatar } from '@/components/calendar/channel-avatar';
import type { T } from '@/i18n/types';
import { analyticsHref, type AnalyticsState } from '@/lib/analytics/logic';
import { PERIODS } from '@/lib/analytics/types';
import type { IntegrationItem } from '@/lib/data/types';

const chip = 'inline-flex h-11 items-center gap-2 rounded-full border ps-2 pe-4 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
const chipClass = (on: boolean) => `${chip} ${on ? 'border-forest/40 bg-lime-soft text-forest' : 'border-line bg-surface hover:bg-wash'}`;

/** Les canaux empilés : la pastille de « Tous les canaux ». */
function AllChannelsIcon({ channels }: { channels: IntegrationItem[] }) {
  return (
    <span className="flex h-7 shrink-0 items-center ps-1.5" aria-hidden="true">
      <span className="flex -space-x-2.5">
        {channels.slice(0, 3).map((c) => <ChannelAvatar key={c.id} channel={c} size={22} badge={false} />)}
      </span>
    </span>
  );
}

/**
 * Choix du canal : « Tous les canaux », puis un canal par pastille avec sa photo et le logo de son réseau. Des liens : l'état est dans l'adresse.
 * Sur téléphone la rangée défile sur sa largeur au lieu de passer à la ligne (`contain-paint` : sans lui, Chrome mobile élargit la page à la largeur
 * de la rangée) ; un seul canal n'a rien à choisir.
 */
export function ChannelFilter({ channels, state, t }: { channels: IntegrationItem[]; state: AnalyticsState; t: T }) {
  if (channels.length < 2) return null;
  return (
    <nav aria-label={t('app.analytics.filters.channel')} className="-mx-5 min-w-0 contain-paint overflow-x-auto px-5 py-1 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:contain-none lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max items-center gap-2 lg:w-auto lg:flex-wrap">
        <li>
          <Link href={analyticsHref({ ...state, channel: null })} scroll={false} aria-current={state.channel === null ? 'true' : undefined} className={chipClass(state.channel === null)}>
            <AllChannelsIcon channels={channels} />
            {t('app.analytics.filters.all')}
          </Link>
        </li>
        {channels.map((c) => (
          <li key={c.id}>
            <Link href={analyticsHref({ ...state, channel: c.id })} scroll={false} aria-current={state.channel === c.id ? 'true' : undefined} className={chipClass(state.channel === c.id)}>
              <ChannelAvatar channel={c} size={28} />
              <span className="max-w-40 truncate">{c.name}</span>
              {c.status === 'refresh_needed' && <span className="size-2 shrink-0 rounded-full bg-warn" title={t('app.channelsPage.status.refresh_needed')}><span className="sr-only">{t('app.channelsPage.status.refresh_needed')}</span></span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Choix de la période : 7, 30 ou 90 jours, en gardant le canal et la métrique. */
export function PeriodFilter({ state, t }: { state: AnalyticsState; t: T }) {
  return (
    <nav aria-label={t('app.analytics.filters.period')} className="shrink-0">
      <ul className="inline-flex rounded-full bg-wash p-1">
        {PERIODS.map((p) => {
          const on = state.days === p;
          return (
            <li key={p}>
              <Link
                href={analyticsHref({ ...state, days: p })}
                scroll={false}
                aria-current={on ? 'true' : undefined}
                className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${on ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
              >
                {t(`app.analytics.period.d${p}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
