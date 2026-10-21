'use client';

import { useState, type ReactNode } from 'react';
import { SocialIcon } from '@/components/social-icon';
import { useT } from '@/i18n/client';
import type { IntegrationItem } from '@/lib/data/types';
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

function Card({ channel, text, firstComment }: { channel: IntegrationItem; text: string; firstComment: string }) {
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
      return (
        <div className="grid gap-3">
          {header}
          <MediaPlaceholder className="aspect-square w-full" />
          <Actions icons={[<HeartIcon key="h" />, <CommentIcon key="c" />, <ShareIcon key="s" />]} />
          {body}
        </div>
      );
    case 'tiktok':
      return (
        <div className="grid gap-3">
          <MediaPlaceholder className="mx-auto aspect-[9/16] w-40" />
          {header}
          {body}
        </div>
      );
    case 'youtube':
      return (
        <div className="grid gap-3">
          <MediaPlaceholder className="aspect-video w-full" />
          {header}
          {body}
        </div>
      );
    case 'x':
      return (
        <div className="grid gap-2.5">
          {header}
          {body}
          <Actions icons={[<CommentIcon key="c" />, <RepostIcon key="r" />, <HeartIcon key="h" />, <ShareIcon key="s" />]} />
          {comment}
        </div>
      );
    default:
      return (
        <div className="grid gap-2.5">
          {header}
          {body}
          <Actions icons={[<HeartIcon key="h" />, <CommentIcon key="c" />, <RepostIcon key="r" />, <ShareIcon key="s" />]} />
          {comment}
        </div>
      );
  }
}

/** Aperçu de la publication, un onglet par canal choisi : le texte tel qu'il apparaîtra, avec ce qui dépasse la limite du réseau. */
export function PostPreview({ channels, text, firstComment = '' }: { channels: IntegrationItem[]; text: string; firstComment?: string }) {
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
        <Card channel={current} text={text} firstComment={firstComment} />
      </article>
    </div>
  );
}
