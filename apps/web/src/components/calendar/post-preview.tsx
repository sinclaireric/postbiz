'use client';

import { useState } from 'react';
import { SocialIcon } from '@/components/social-icon';
import { useT } from '@/i18n/client';
import type { IntegrationItem } from '@/lib/data/types';
import { networkName } from '@/lib/networks';
import { FIRST_COMMENT_RULES, NETWORK_RULES, supportsFirstComment } from '@/lib/posts/logic';
import { sliceAtLimit } from '@/lib/text/length';
import { ChannelAvatar } from './channel-avatar';
import { NetworkPost, type PreviewMedia } from './network-post';

function CommentBubble({ channel, text }: { channel: IntegrationItem; text: string }) {
  const max = FIRST_COMMENT_RULES[channel.networkId]?.maxLength ?? Infinity;
  const [ok, over] = sliceAtLimit(channel.networkId, text, max);
  return (
    <div className="flex gap-2.5">
      <ChannelAvatar channel={channel} size={28} badge={false} />
      <div className="min-w-0 rounded-2xl bg-[#f0f2f5] px-3 py-2">
        <p className="truncate text-xs font-semibold">{channel.name}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
          {ok}
          {over && <mark className="rounded bg-danger-soft px-0.5 text-danger">{over}</mark>}
        </p>
      </div>
    </div>
  );
}

/** Le texte tel que le réseau l'affichera : même présentation que la fiche d'une publication du calendrier, avec ce qui dépasse la limite surligné. */
function Card({ channel, text, firstComment, media }: { channel: IntegrationItem; text: string; firstComment: string; media: PreviewMedia[] }) {
  const t = useT();
  const comment = firstComment.trim() && supportsFirstComment(channel.networkId) ? <CommentBubble channel={channel} text={firstComment} /> : null;
  return <NetworkPost channel={channel} text={text} media={media} when={t('app.composer.previewNow')} limit={NETWORK_RULES[channel.networkId].maxLength} footer={comment} />;
}

/** Aperçu de la publication, un onglet par canal choisi : le texte tel qu'il apparaîtra, avec ce qui dépasse la limite du réseau. */
export function PostPreview({ channels, text, firstComment = '', media = [] }: { channels: IntegrationItem[]; text: string; firstComment?: string; media?: PreviewMedia[] }) {
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
      <article aria-label={t('app.composer.previewOf', { network: networkName(current.networkId) })} className="rounded-2xl bg-wash p-3">
        <Card channel={current} text={text} firstComment={firstComment} media={media} />
      </article>
    </div>
  );
}
