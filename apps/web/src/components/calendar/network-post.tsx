'use client';

import type { ReactNode, SVGProps } from 'react';
import { useT } from '@/i18n/client';
import { MediaThumb } from '@/components/media/media-thumb';
import { LOCALE_META } from '@/i18n/config';
import type { IntegrationItem } from '@/lib/data/types';
import { sliceAtLimit } from '@/lib/text/length';
import { ChannelAvatar } from './channel-avatar';
import { CommentIcon as Chat, HeartIcon as Heart, RepostIcon as Repost, ShareIcon as Share } from './composer-icons';

// Aperçu d'une publication « comme sur le réseau » : même ordre des éléments, mêmes couleurs, même barre d'actions que Facebook, Instagram, X, LinkedIn,
// TikTok et YouTube. Ce n'est pas un rendu exact (les réseaux changent souvent leur interface) ; c'est la même idée que l'aperçu de l'application mobile.
// Sert à la fiche d'une publication du calendrier (avec sa vraie date) et à l'aperçu du composeur (« À l'instant »).

export interface PreviewMedia {
  id: string;
  kind: 'image' | 'video';
  name: string;
  alt?: string;
  /** Le fichier (image) ; sinon on retombe sur la vignette. */
  url?: string | null;
  thumbUrl?: string | null;
  durationSeconds?: number | null;
}

type Channel = Pick<IntegrationItem, 'networkId' | 'name' | 'pictureUrl' | 'username'>;

export interface NetworkPostProps {
  channel: Channel;
  text: string;
  media?: PreviewMedia[];
  /** Date de publication (ISO) : affichée au format du réseau. */
  date?: string | null;
  /** Texte à la place de la date (« À l'instant », « Brouillon »…). */
  when?: string;
  /** Longueur maximale du texte sur ce réseau : ce qui dépasse est surligné (composeur). */
  limit?: number;
  /** Sous le texte et les médias (par exemple le premier commentaire). */
  footer?: ReactNode;
}

const URL_OR_TAG = /(https?:\/\/\S+|#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+)/gu;

/** Texte avec liens, #hashtags et @mentions colorés comme sur le réseau. Les retours à la ligne sont conservés. */
function Rich({ text, link, className = '' }: { text: string; link: string; className?: string }) {
  const parts = text.split(URL_OR_TAG);
  return (
    <p className={`break-words whitespace-pre-wrap ${className}`}>
      {parts.map((part, i) => (i % 2 === 1 ? <span key={i} style={{ color: link }}>{part}</span> : part))}
    </p>
  );
}

/** Texte, avec en rouge ce qui dépasse la limite du réseau. */
function Body({ text, limit, networkId, link, className }: { text: string; limit?: number; networkId: Channel['networkId']; link: string; className?: string }) {
  if (!text.trim()) return null;
  if (limit === undefined) return <Rich text={text} link={link} className={className} />;
  const [ok, over] = sliceAtLimit(networkId, text, limit);
  return (
    <div className={className}>
      <Rich text={ok} link={link} />
      {over && <mark className="rounded bg-danger-soft px-0.5 whitespace-pre-wrap text-danger">{over}</mark>}
    </div>
  );
}

// --------------------------------------------------------------------------------------------------------------------------------------- icônes
const ic = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
type P = SVGProps<SVGSVGElement>;
const Send = (p: P) => <svg {...ic} {...p}><path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" /></svg>;
const Bookmark = (p: P) => <svg {...ic} {...p}><path d="M6 3h12v18l-6-4.5L6 21V3Z" /></svg>;
const Thumb = (p: P) => <svg {...ic} {...p}><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4-8a2.2 2.2 0 0 1 3 2l-.500 4H19a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 18 20H7" /></svg>;
const ThumbDown = (p: P) => <svg {...ic} {...p} className={`rotate-180 ${p.className ?? ''}`}><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4-8a2.2 2.2 0 0 1 3 2l-.500 4H19a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 18 20H7" /></svg>;
const Globe = (p: P) => <svg {...ic} width={12} height={12} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>;
const More = (p: P) => <svg {...ic} fill="currentColor" stroke="none" {...p}><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>;
const Views = (p: P) => <svg {...ic} {...p}><path d="M5 20V10M12 20V4M19 20v-6" /></svg>;
const Music = (p: P) => <svg {...ic} width={13} height={13} {...p}><path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z" /></svg>;
const Play = () => <svg width="22" height="22" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M4 2.6v8.8a.6.6 0 0 0 .900.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4a.6.6 0 0 0-.900.5Z" /></svg>;

// --------------------------------------------------------------------------------------------------------------------------------------- médias
/** Un média de l'aperçu : l'image elle-même (plus nette que la vignette), ou la vignette d'une vidéo avec son bouton lecture. */
function Shot({ m, className = '' }: { m: PreviewMedia; className?: string }) {
  if (m.kind === 'image' && (m.url || m.thumbUrl)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire du stockage
      <img src={(m.url ?? m.thumbUrl)!} alt={m.alt || m.name} loading="lazy" draggable={false} className={`h-full w-full object-cover ${className}`} />
    );
  }
  return <MediaThumb item={{ kind: m.kind, url: null, thumbUrl: m.thumbUrl ?? null, name: m.name, durationSeconds: m.durationSeconds }} className={className} />;
}

/** Médias sous le texte (Facebook, LinkedIn, X) : un seul en grand, sinon une grille de deux colonnes (« +n » au-delà de quatre). */
function Gallery({ media, rounded = false, bleed = false }: { media: PreviewMedia[]; rounded?: boolean; bleed?: boolean }) {
  if (media.length === 0) return null;
  const shown = media.slice(0, 4);
  const more = media.length - shown.length;
  const frame = `${rounded ? 'overflow-hidden rounded-2xl border border-black/10' : ''} ${bleed ? '' : ''}`;
  if (shown.length === 1) {
    return <div className={`${frame} max-h-[460px] overflow-hidden bg-[#f0f2f5]`}><div className="aspect-[4/3] w-full"><Shot m={shown[0]!} /></div></div>;
  }
  return (
    <div className={`${frame} grid gap-0.5 overflow-hidden bg-white ${shown.length === 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2'}`}>
      {shown.map((m, i) => (
        <div key={m.id} className={`relative aspect-square ${shown.length === 3 && i === 0 ? 'row-span-2 aspect-auto' : ''}`}>
          <Shot m={m} />
          {more > 0 && i === shown.length - 1 && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white">+{more}</span>}
        </div>
      ))}
    </div>
  );
}

/** Zone des médias d'Instagram : carré en 4:5, avec le rang « 1/3 » d'un carrousel et ses points. */
function InstagramFrame({ media, empty }: { media: PreviewMedia[]; empty: string }) {
  if (media.length === 0) {
    return <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-1 bg-[#efefef] text-xs text-[#737373]"><span className="text-3xl" aria-hidden="true">🖼</span>{empty}</div>;
  }
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden bg-[#efefef]">
      <Shot m={media[0]!} />
      {media.length > 1 && (
        <>
          <span className="absolute end-3 top-3 rounded-full bg-black/65 px-2.5 py-0.5 text-xs font-semibold text-white tabular-nums">1/{media.length}</span>
          <span className="absolute inset-x-0 bottom-3 flex justify-center gap-1" aria-hidden="true">
            {media.map((m, i) => <span key={m.id} className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-[#0095f6]' : 'bg-white/70'}`} />)}
          </span>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------------------------------------------------------- cartes
const card = 'rounded-lg border bg-white text-start text-[#050505] shadow-[0_1px_2px_rgba(0,0,0,0.06)]';

export function NetworkPost({ channel, text, media = [], date, when, limit, footer }: NetworkPostProps) {
  const t = useT();
  const tag = LOCALE_META[t.locale].tag;
  const fmt = (opts: Intl.DateTimeFormatOptions) => (date ? new Date(date).toLocaleString(tag, opts) : (when ?? ''));
  const name = channel.name;
  const handle = (channel.username ?? name).replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
  const avatar = (size: number) => <ChannelAvatar channel={channel} size={size} badge={false} />;
  const body = (link: string, className = 'text-[15px] leading-[1.35]') => <Body text={text} limit={limit} networkId={channel.networkId} link={link} className={className} />;

  switch (channel.networkId) {
    case 'facebook':
      return (
        <div className={`${card} border-[#e4e6eb]`}>
          <div className="flex items-center gap-2.5 p-3">
            {avatar(40)}
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[15px] font-semibold">{name}</p>
              <p className="flex items-center gap-1 text-[13px] text-[#65676b]">{fmt({ day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}{date || when ? ' · ' : ''}<Globe /></p>
            </div>
            <More className="text-[#65676b]" />
          </div>
          {text.trim() && <div className="px-3 pb-3">{body('#216fdb')}</div>}
          <Gallery media={media} />
          <div className="flex justify-around border-t border-[#e4e6eb] py-2 text-sm font-semibold text-[#65676b]">
            {([[Thumb, 'like'], [Chat, 'comment'], [Share, 'share']] as const).map(([Icon, key]) => <span key={key} className="flex items-center gap-1.5"><Icon />{t(`app.networkPost.${key}`)}</span>)}
          </div>
          {footer && <div className="border-t border-[#e4e6eb] px-3 py-3">{footer}</div>}
        </div>
      );

    case 'instagram':
    case 'instagram_standalone':
      return (
        <div className={`${card} overflow-hidden border-[#dbdbdb] text-[#262626]`}>
          <div className="flex items-center gap-2.5 p-2.5">
            <span className="rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#962fbf] p-[2px]"><span className="block rounded-full bg-white p-[2px]">{avatar(30)}</span></span>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{handle}</p>
            <More />
          </div>
          <InstagramFrame media={media} empty={t('app.networkPost.noMedia')} />
          <div className="flex items-center gap-3.5 px-3 pt-2.5">
            <Heart width={24} height={24} /><Chat width={22} height={22} /><Send width={22} height={22} />
            <span className="flex-1" /><Bookmark width={22} height={22} />
          </div>
          <div className="px-3 pt-2 pb-3 text-sm leading-[1.35]">
            {text.trim() && (
              <div className="flex gap-1">
                <span className="shrink-0 font-semibold">{handle}</span>
                <Body text={text} limit={limit} networkId={channel.networkId} link="#00376b" className="min-w-0" />
              </div>
            )}
            {(date || when) && <p className="mt-1.5 text-[10px] tracking-wide text-[#8e8e8e] uppercase">{fmt({ day: 'numeric', month: 'long', year: 'numeric' })}</p>}
          </div>
          {footer && <div className="border-t border-[#efefef] px-3 py-3">{footer}</div>}
        </div>
      );

    case 'x':
      return (
        <div className={`${card} border-[#eff3f4] px-3 pt-3`}>
          <div className="flex gap-2.5">
            {avatar(40)}
            <div className="min-w-0 flex-1 pb-3">
              <p className="flex items-center gap-1 text-[15px] leading-tight">
                <span className="truncate font-bold text-[#0f1419]">{name}</span>
                <span className="truncate text-[#536471]">@{handle}</span>
                {(date || when) && <span className="shrink-0 text-[#536471]">· {fmt({ day: 'numeric', month: 'short' })}</span>}
              </p>
              {text.trim() && <div className="mt-0.5">{body('#1d9bf0', 'text-[15px] leading-5 text-[#0f1419]')}</div>}
              {media.length > 0 && <div className="mt-3"><Gallery media={media} rounded /></div>}
              <div className="mt-3 flex justify-between pe-8 text-[#536471]"><Chat /><Repost /><Heart /><Views /><Share /></div>
              {footer && <div className="mt-3 border-t border-[#eff3f4] pt-3">{footer}</div>}
            </div>
          </div>
        </div>
      );

    case 'linkedin':
    case 'linkedin_page':
      return (
        <div className={`${card} overflow-hidden border-[#e0dfdc] text-[rgba(0,0,0,0.9)]`}>
          <div className="flex gap-2 p-3">
            <span className={`shrink-0 overflow-hidden ${channel.networkId === 'linkedin_page' ? 'rounded' : 'rounded-full'}`}>{avatar(48)}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-xs text-[rgba(0,0,0,0.6)]">{t('app.networkPost.followers')}</p>
              <p className="flex items-center gap-1 text-xs text-[rgba(0,0,0,0.6)]">{fmt({ day: 'numeric', month: 'short' })}{date || when ? ' •' : ''}<Globe /></p>
            </div>
            <More className="text-[rgba(0,0,0,0.6)]" />
          </div>
          {text.trim() && <div className="px-3 pb-3">{body('#0a66c2', 'text-sm leading-5')}</div>}
          <Gallery media={media} />
          <div className="flex justify-around border-t border-[#e0dfdc] py-2 text-xs font-semibold text-[rgba(0,0,0,0.6)]">
            {([[Thumb, 'like'], [Chat, 'comment'], [Repost, 'repost'], [Send, 'send']] as const).map(([Icon, key]) => (
              <span key={key} className="flex flex-col items-center gap-0.5"><Icon width={20} height={20} />{t(`app.networkPost.${key}`)}</span>
            ))}
          </div>
          {footer && <div className="border-t border-[#e0dfdc] px-3 py-3">{footer}</div>}
        </div>
      );

    case 'tiktok': {
      const cover = media[0];
      return (
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-xl bg-black text-white">
          {cover ? <div className="absolute inset-0 opacity-90"><Shot m={cover} /></div> : <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">{t('app.networkPost.videoNeeded')}</div>}
          {cover && cover.kind === 'video' && <span className="absolute inset-0 flex items-center justify-center text-white/90"><Play /></span>}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" aria-hidden="true" />
          <div className="absolute end-2.5 bottom-16 flex flex-col items-center gap-4">
            <span className="rounded-full ring-2 ring-white">{avatar(40)}</span>
            <Heart width={28} height={28} /><Chat width={28} height={28} /><Bookmark width={28} height={28} /><Share width={28} height={28} />
          </div>
          <div className="absolute inset-x-3 bottom-3 pe-14">
            <p className="text-[15px] font-bold">@{handle}</p>
            {text.trim() && <Rich text={text} link="#ffffff" className="mt-1 line-clamp-4 text-sm leading-[1.35]" />}
            <p className="mt-1.5 flex items-center gap-1.5 text-xs"><Music />{t('app.networkPost.originalSound')} · {name}</p>
          </div>
        </div>
      );
    }

    case 'youtube':
      return (
        <div className={`${card} border-[#e5e5e5] p-3.5 text-[#0f0f0f]`}>
          <div className="flex items-center gap-2.5">
            {avatar(40)}
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-xs text-[#606060]">{fmt({ day: 'numeric', month: 'long', year: 'numeric' })}{date || when ? ' · ' : ''}{t('app.networkPost.communityPost')}</p>
            </div>
            <More className="rotate-90" />
          </div>
          {text.trim() && <div className="mt-2.5">{body('#065fd4', 'text-sm leading-5')}</div>}
          {media.length > 0 && <div className="mt-2.5"><Gallery media={media} rounded /></div>}
          <div className="mt-3 flex items-center gap-5"><Thumb /><ThumbDown /><Chat /></div>
          {footer && <div className="mt-3 border-t border-[#e5e5e5] pt-3">{footer}</div>}
        </div>
      );

    default:
      return (
        <div className={`${card} border-[#e6e6ea] p-3.5`}>
          <div className="flex items-center gap-2.5">{avatar(36)}<div className="leading-tight"><p className="font-semibold">{name}</p><p className="text-xs text-[#6b6b70]">{fmt({ dateStyle: 'medium', timeStyle: 'short' })}</p></div></div>
          {text.trim() && <div className="mt-2.5">{body('#3b64f6')}</div>}
          {media.length > 0 && <div className="mt-2.5"><Gallery media={media} rounded /></div>}
          {footer && <div className="mt-3 border-t border-[#e6e6ea] pt-3">{footer}</div>}
        </div>
      );
  }
}
