'use client';

import { useState, type ReactNode } from 'react';
import { MediaThumb } from '@/components/media/media-thumb';
import { SocialIcon } from '@/components/social-icon';
import { useT } from '@/i18n/client';
import type { IntegrationItem, MediaItem } from '@/lib/data/types';
import { networkName } from '@/lib/networks';
import type { NetworkId } from '@/lib/inbox/types';
import { FIRST_COMMENT_RULES, NETWORK_RULES, supportsFirstComment } from '@/lib/posts/logic';
import { sliceAtLimit } from '@/lib/text/length';
import { ChannelAvatar } from './channel-avatar';
import { CommentIcon, HeartIcon, ImageIcon, RepostIcon, ShareIcon } from './composer-icons';

function Body({ text, networkId, max }: { text: string; networkId: NetworkId; max: number }) {
  const [ok, over] = sliceAtLimit(networkId, text, max);
  return (
    <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap text-ink">
      {ok}
      {over && <mark className="rounded bg-danger-soft px-0.5 text-danger">{over}</mark>}
    </p>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      <span className="h-2.5 w-11/12 rounded-full bg-wash" />
      <span className="h-2.5 w-9/12 rounded-full bg-wash" />
      <span className="h-2.5 w-6/12 rounded-full bg-wash" />
    </div>
  );
}

const MediaPlaceholder = ({ className }: { className: string }) => (
  <div className={`flex items-center justify-center rounded-lg bg-wash text-subtle ${className}`} aria-hidden="true"><ImageIcon width={28} height={28} /></div>
);

type Shown = Pick<MediaItem, 'id' | 'kind' | 'url' | 'thumbUrl' | 'name' | 'durationSeconds'>;

/** Couverture d'une publication à média unique (Instagram, TikTok, YouTube) : le premier média, avec le rang « 1/3 » s'il y en a plusieurs. */
function Cover({ media, className }: { media: Shown[]; className: string }) {
  if (media.length === 0) return <MediaPlaceholder className={className} />;
  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      <MediaThumb item={media[0]!} />
      {media.length > 1 && <span className="absolute end-2 top-2 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">1/{media.length}</span>}
    </div>
  );
}

/** Médias sous le texte (Facebook, LinkedIn, X) : un grand, ou une grille de deux colonnes ; « +n » quand il y en a plus de quatre. */
function Gallery({ media }: { media: Shown[] }) {
  if (media.length === 0) return null;
  const shown = media.slice(0, 4);
  const more = media.length - shown.length;
  return (
    <div className={`grid gap-1 overflow-hidden rounded-lg ${shown.length === 1 ? '' : 'grid-cols-2'}`}>
      {shown.map((m, i) => (
        <div key={m.id} className={`relative ${shown.length === 1 ? 'aspect-video' : 'aspect-square'}`}>
          <MediaThumb item={m} />
          {more > 0 && i === shown.length - 1 && <span className="absolute inset-0 flex items-center justify-center bg-ink/55 text-lg font-semibold text-white">+{more}</span>}
        </div>
      ))}
    </div>
  );
}

const Actions = ({ icons }: { icons: ReactNode[] }) => (
  <div className="mt-3 flex items-center gap-5 border-t border-line pt-2.5 text-subtle" aria-hidden="true">{icons.map((icon, i) => <span key={i}>{icon}</span>)}</div>
);

/** Le premier commentaire, tel qu'il apparaîtra sous la publication (sur X : une réponse). */
function CommentBubble({ channel, text }: { channel: IntegrationItem; text: string }) {
  const max = FIRST_COMMENT_RULES[channel.networkId]?.maxLength ?? Infinity;
  const [ok, over] = sliceAtLimit(channel.networkId, text, max);
  return (
    <div className="mt-1 flex gap-2.5 border-t border-line pt-3">
      <ChannelAvatar channel={channel} size={28} badge={false} />
      <div className="min-w-0 rounded-2xl bg-wash px-3 py-2">
        <p className="truncate text-xs font-semibold">{channel.name}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
          {ok}
          {over && <mark className="rounded bg-danger-soft px-0.5 text-danger">{over}</mark>}
        </p>
      </div>
    </div>
  );
}

function Card({ channel, text, firstComment, media }: { channel: IntegrationItem; text: string; firstComment: string; media: Shown[] }) {
  const t = useT();
  const max = NETWORK_RULES[channel.networkId].maxLength;
  const body = text.trim() ? <Body text={text} networkId={channel.networkId} max={max} /> : <Skeleton />;
  const comment = firstComment.trim() && supportsFirstComment(channel.networkId) ? <CommentBubble channel={channel} text={firstComment} /> : null;
  const now = t('app.composer.previewNow');
  const handle = channel.username ? `@${channel.username.replace(/^@/, '')}` : null;
  const header = (
    <div className="flex items-center gap-2.5">
      <ChannelAvatar channel={channel} size={40} badge={false} />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[14px] font-semibold">{channel.name}</p>
        <p className="truncate text-xs text-subtle">{channel.networkId === 'x' ? [handle, now].filter(Boolean).join(' · ') : channel.networkId === 'instagram' ? (handle ?? channel.name) : now}</p>
      </div>
    </div>
  );

  switch (channel.networkId) {
    case 'instagram':
    case 'instagram_standalone':
      return (
        <div className="grid gap-3">
          {header}
          <Cover media={media} className="aspect-square w-full" />
          <Actions icons={[<HeartIcon key="h" />, <CommentIcon key="c" />, <ShareIcon key="s" />]} />
          {body}
        </div>
      );
    case 'tiktok':
      return (
        <div className="grid gap-3">
          <Cover media={media} className="mx-auto aspect-[9/16] w-40" />
          {header}
          {body}
        </div>
      );
    case 'youtube':
      return (
        <div className="grid gap-3">
          <Cover media={media} className="aspect-video w-full" />
          {header}
          {body}
        </div>
      );
    case 'x':
      return (
        <div className="grid gap-2.5">
          {header}
          {body}
          <Gallery media={media} />
          <Actions icons={[<CommentIcon key="c" />, <RepostIcon key="r" />, <HeartIcon key="h" />, <ShareIcon key="s" />]} />
          {comment}
        </div>
      );
    default:
      return (
        <div className="grid gap-2.5">
          {header}
          {body}
          <Gallery media={media} />
          <Actions icons={[<HeartIcon key="h" />, <CommentIcon key="c" />, <RepostIcon key="r" />, <ShareIcon key="s" />]} />
          {comment}
        </div>
      );
  }
}

/** Aperçu de la publication, un onglet par canal choisi : le texte tel qu'il apparaîtra, avec ce qui dépasse la limite du réseau. */
export function PostPreview({ channels, text, firstComment = '', media = [] }: { channels: IntegrationItem[]; text: string; firstComment?: string; media?: Shown[] }) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);

  if (channels.length === 0) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl bg-wash px-6 py-10 text-center text-sm text-muted">
        <div className="w-40 rounded-xl border border-line bg-surface p-3" aria-hidden="true">
          <span className="mb-2 flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-wash" /><span className="h-2 w-16 rounded-full bg-wash" /></span>
          <span className="block h-16 rounded-lg bg-wash" />
        </div>
        {t('app.composer.previewEmpty')}
      </div>
    );
  }

  const current = channels.find((c) => c.id === picked) ?? channels[0]!;
  return (
    <div className="grid gap-3">
      {channels.length > 1 && (
        <div role="tablist" aria-label={t('app.composer.preview')} className="flex flex-wrap gap-1.5">
          {channels.map((c) => (
            <button
              key={c.id} type="button" role="tab" aria-selected={c.id === current.id} onClick={() => setPicked(c.id)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${c.id === current.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-muted hover:border-ink/40'}`}
            >
              <SocialIcon id={c.networkId} size={14} />
              <span className="max-w-24 truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
      <article aria-label={t('app.composer.previewOf', { network: networkName(current.networkId) })} className="rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
        <Card channel={current} text={text} firstComment={firstComment} media={media} />
      </article>
    </div>
  );
}
