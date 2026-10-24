import { ChannelAvatar } from '@/components/calendar/channel-avatar';
import type { T } from '@/i18n/types';
import { formatDayYear } from '@/lib/analytics/format';
import { dayKey } from '@/lib/analytics/logic';
import type { RecentPost } from '@/lib/analytics/types';
import type { IntegrationItem } from '@/lib/data/types';
import { networkName } from '@/lib/networks';
import { tile } from './panel';

/** Adresse du réseau : seulement du http(s), jamais un autre schéma venu d'une base de données. */
const webUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

/** Les dernières publications envoyées : le canal et sa photo, la date, le début du texte et un lien vers le réseau. */
export function RecentPosts({ posts, channels, t }: { posts: RecentPost[]; channels: IntegrationItem[]; t: T }) {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const items = posts.flatMap((p) => {
    const channel = byId.get(p.integrationId);
    return channel ? [{ p, channel }] : [];
  });
  if (items.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-muted">{t('app.analytics.recent.empty')}</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map(({ p, channel }) => {
        const href = webUrl(p.url);
        const text = p.content.trim();
        return (
          <li key={p.id} className={`${tile} flex min-w-0 flex-col p-4`}>
            <div className="flex items-center gap-3">
              <ChannelAvatar channel={channel} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{channel.name}</p>
                <p className="text-xs text-muted">{formatDayYear(t.locale, dayKey(new Date(p.at)))}</p>
              </div>
            </div>
            <p className={`mt-3 line-clamp-4 text-sm leading-relaxed break-words whitespace-pre-line ${text ? 'text-ink/85' : 'text-subtle italic'}`}>{text || t('app.analytics.recent.noText')}</p>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex min-h-10 items-center gap-1.5 pt-3 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {t('app.analytics.recent.open', { network: networkName(channel.networkId) })}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
                  <path d="M5 3h6v6M11 3 4 10" />
                </svg>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
