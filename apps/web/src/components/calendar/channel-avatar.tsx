import { SocialIcon } from '@/components/social-icon';
import { networkById } from '@/lib/networks';
import type { IntegrationItem } from '@/lib/data/types';

type Channel = Pick<IntegrationItem, 'networkId' | 'name' | 'pictureUrl'>;

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] ?? '').join('').toUpperCase() || '?';

/** Photo du canal (ou ses initiales sur la couleur du réseau), avec le logo du réseau en pastille dans le coin. */
export function ChannelAvatar({ channel, size = 44, badge = true }: { channel: Channel; size?: number; badge?: boolean }) {
  const color = networkById(channel.networkId)?.color ?? '#888';
  const badgeSize = Math.max(14, Math.round(size * 0.42));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {channel.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- photo de profil servie par le réseau
        <img src={channel.pictureUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white" style={{ background: color, fontSize: size * 0.36 }}>{initials(channel.name)}</span>
      )}
      {badge && <SocialIcon id={channel.networkId} size={badgeSize} className="absolute -end-1 -bottom-1 ring-2 ring-surface" />}
    </span>
  );
}
