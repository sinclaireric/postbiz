'use client';

import type { CSSProperties, ReactNode } from 'react';
import { SocialIcon, type SocialId } from '@/components/social-icon';
import { useT } from '@/i18n/client';
import { networkById, networkName, type Network } from '@/lib/networks';
import { NEW_POSTS, POSTS, THREADS, logoName, type DemoLabels, type DemoThread, type Scenario } from './demo-data';

const vars = (v: Record<string, string | number>) => v as CSSProperties;
/** Décalage d'une animation dans la scène (s), lu par `.demo-*` dans globals.css. */
export const at = (seconds: number) => vars({ '--d': `${seconds}s` });
const color = (id: Network['id']) => networkById(id)?.color ?? '#999';

/* ------------------------------------------------------------------ éléments communs */

function Header({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="demo-fade flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line px-5" style={at(0.1)}>
      <h3 className="truncate text-[15px] font-semibold tracking-tight">{title}</h3>
      {children}
    </header>
  );
}

/** `mirror` : la flèche se retourne en écriture de droite à gauche (faux pour le curseur de navigation, posé en coordonnées d'écran). */
export function CursorArrow({ label, mirror = true }: { label: string; mirror?: boolean }) {
  return (
    <div className="absolute start-0 top-0 flex items-start">
      <svg className={`-mt-[2px] -ms-[3px] shrink-0 drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)] ${mirror ? 'rtl:-scale-x-100' : ''}`} width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 2 15 7.6 9.8 9.1 7 15 3 2Z" fill="#111110" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span className="mt-2.5 -ms-1 rounded-full bg-ink/70 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white">{label}</span>
    </div>
  );
}

/**
 * Barre de saisie du bas (agent et inbox) : le texte se tape, le curseur vient cliquer sur envoyer, puis le champ se vide.
 * Le point d'ancrage du curseur (0 × 0) est posé sur le bouton d'envoi : sa pointe y tombe, quelle que soit la largeur de l'étiquette.
 */
function ComposerBar({ placeholder, text, typeAt, duration, sendAt }: { placeholder: string; text: string; typeAt: number; duration: number; sendAt: number }) {
  const t = useT();
  return (
    <div className="relative px-5 pb-4">
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface p-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink/60"><PlusIcon /></span>
        <div className="relative flex h-6 min-w-0 flex-1 items-center overflow-hidden text-[14px]">
          <span className="demo-hide-at absolute inset-y-0 start-0 flex items-center whitespace-nowrap text-ink/40" style={at(typeAt)}>{placeholder}</span>
          <span className="demo-show-at absolute inset-y-0 start-0 flex items-center whitespace-nowrap text-ink/40" style={at(sendAt)}>{placeholder}</span>
          <span className="demo-type" style={vars({ '--d': `${typeAt}s`, '--end': `${sendAt}s`, '--dur': `${duration}s`, '--n': [...text].length })}>{text}</span>
        </div>
        <span className="demo-press flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-white" style={at(sendAt - 0.1)}><ArrowUpIcon /></span>
      </div>
      {/* Le curseur disparaît peu après le clic : il ne reste jamais deux curseurs à l'écran quand l'onglet suivant s'annonce. */}
      <div className="demo-hide-at pointer-events-none absolute end-[50px] bottom-[38px] z-10 h-0 w-0" style={at(sendAt + 0.7)}>
        <div className="demo-cursor h-0 w-0" style={vars({ '--d': `${sendAt - 0.1 - 1.5}s`, '--sx': '-320px', '--sy': '-200px' })}>
          <CursorArrow label={t('home.demo.you')} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ onglet Agent : le chat */

function Step({ text, start }: { text: string; start: number }) {
  return (
    <div className="demo-enter flex items-center gap-2 text-[13px] text-ink/70" style={at(start)}>
      <span className="relative size-4 shrink-0">
        <span className="demo-hide-at absolute inset-0" style={at(start + 0.9)}>
          <i className="demo-spin block size-4 rounded-full border-2 border-ink/15 border-t-ink/60" />
        </span>
        <span className="demo-show-at absolute inset-0 flex items-center justify-center rounded-full bg-ok text-white" style={at(start + 0.9)}><CheckIcon size={10} /></span>
      </span>
      {text}
    </div>
  );
}

/** Tu écris à l'agent, il rédige les publications puis les programme : le déroulé de la vidéo « planification par agent IA ». */
export function AgentScene({ labels }: { labels: DemoLabels }) {
  const t = useT();
  const prompt = t('home.demo.prompt');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title={t('app.nav.agent')}>
        <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] font-medium">
          {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
          <img src="/agents/claude.svg" alt="" width={16} height={16} className="size-4 rounded-[27%]" />
          Claude
        </span>
      </Header>

      <div className="mx-auto flex min-h-0 w-full max-w-[640px] flex-1 flex-col gap-4 overflow-hidden px-5 pt-5">
        <p className="demo-enter ms-auto w-fit max-w-[85%] rounded-2xl rounded-se-md bg-ink px-3.5 py-2 text-[14px] leading-snug text-white" style={at(3.6)}>{prompt}</p>

        <div className="flex gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
          <img src="/agents/claude.svg" alt="" width={28} height={28} className="demo-enter size-7 shrink-0 rounded-[27%]" style={at(4.3)} />
          <div className="min-w-0 flex-1">
            <div className="grid">
              <div className="demo-hide-at col-start-1 row-start-1" style={at(5.0)}>
                <span className="demo-enter flex w-fit items-center gap-1 rounded-2xl rounded-ss-md bg-wash px-3.5 py-4 text-ink" style={at(4.3)}>
                  {[0, 0.15, 0.3].map((delay) => (
                    <i key={delay} className="demo-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${delay}s` }} />
                  ))}
                </span>
              </div>
              <div className="col-start-1 row-start-1 space-y-2">
                <Step text={t('home.demo.step1')} start={5.0} />
                <Step text={t('home.demo.step2')} start={6.1} />
                <Step text={t('home.demo.step3')} start={7.2} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {NEW_POSTS.agent.map((idx, k) => {
                const post = POSTS[idx]!;
                return (
                  <div key={idx} className="demo-enter overflow-hidden rounded-xl border border-line bg-surface shadow-sm" style={at(8.6 + k * 0.3)}>
                    <div className="h-1" style={{ background: color(post.network) }} />
                    <div className="p-2 sm:p-2.5">
                      <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-ink/55 sm:text-[11px]">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: color(post.network) }} />
                        {networkName(post.network)}
                      </p>
                      <p className="mt-1 text-[11.5px] leading-snug font-medium sm:text-[12.5px]">{t(post.title)}</p>
                      <p className="mt-1.5 text-[10px] text-ink/50 sm:text-[11px]">{labels.postWhen[idx]}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="demo-enter mt-3 flex items-center gap-1.5 text-[13.5px] font-medium" style={at(9.9)}>
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-ok text-white"><CheckIcon size={10} /></span>
              {t('home.demo.agentDone')}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[640px]">
        <ComposerBar placeholder={t('home.demo.agentPlaceholder')} text={prompt} typeAt={0.8} duration={2.2} sendAt={3.5} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ onglet Calendrier */

function PostCard({ idx, labels, fresh, start }: { idx: number; labels: DemoLabels; fresh: boolean; start: number }) {
  const t = useT();
  const post = POSTS[idx]!;
  return (
    <div className="demo-enter" style={at(start)}>
      <div className={`overflow-hidden rounded-xl border border-line bg-surface shadow-sm ${fresh ? 'demo-glow' : ''}`} style={fresh ? at(start + 0.15) : undefined}>
        <div className="h-1" style={{ background: color(post.network) }} />
        <div className="p-2">
          <p className="flex items-center justify-between gap-1 text-[11px] text-ink/50">
            <span>{labels.postTimes[idx]}</span>
            {fresh && <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-ok text-white" title={t('app.calendar.state.queued')}><CheckIcon size={9} /></span>}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug font-medium">{t(post.title)}</p>
          <p className="mt-1.5 text-[10.5px] text-ink/50">{networkName(post.network)}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Le calendrier de la semaine. Option « agent » : les trois publications de l'agent s'y posent. Option « manuelle » : le
 * curseur ouvre « Nouvelle publication », choisit un canal, écrit le texte et programme (déroulé de la vidéo « classique »).
 */
export function CalendarScene({ labels, scenario, compact = false }: { labels: DemoLabels; scenario: Scenario; compact?: boolean }) {
  const t = useT();
  const manual = scenario === 'manual';
  const fresh = NEW_POSTS[scenario];
  const manualText = t('home.demo.manualText');
  const freshStart = manual ? 10.0 : 0.9;
  const freshStep = manual ? 0.4 : 0.8;
  const toastAt = manual ? 10.8 : 3.6;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Header title={t('app.nav.calendar')}>
        <div className="flex items-center gap-2.5">
          <span className={`hidden text-[12px] text-ink/55 ${compact ? '' : 'xl:inline'}`}>{labels.range}</span>
          <span className={`hidden items-center rounded-full border border-line p-0.5 text-[11.5px] ${compact ? '' : 'md:flex'}`}>
            <span className="px-2 py-0.5 text-ink/55">{t('app.calendar.day')}</span>
            <span className="rounded-full bg-lime-soft px-2 py-0.5 font-medium text-forest">{t('app.calendar.week')}</span>
            <span className="px-2 py-0.5 text-ink/55">{t('app.calendar.month')}</span>
          </span>
          <span className={`${manual ? 'demo-press' : ''} rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap text-white`} style={at(2.1)}>{t('app.calendar.newPost')}</span>
        </div>
      </Header>

      <div className={`relative grid min-h-0 flex-1 ${compact ? 'grid-cols-5' : 'grid-cols-3 md:grid-cols-7'}`}>
        {labels.days.map((d, i) => (
          <div
            key={i}
            className={`demo-fade flex-col border-line ${compact ? (i < 5 ? 'flex border-s' : 'hidden') : `md:flex md:border-s ${i >= 1 && i <= 3 ? 'flex border-s' : 'hidden'}`} ${i >= 5 ? 'bg-wash/50' : ''}`}
            style={at(0.05 * i)}
          >
            <p className="px-2 pt-2 pb-1 text-center text-[11px] text-ink/50 uppercase">
              {d.weekday}
              <span className={`mx-auto mt-1 flex size-7 items-center justify-center rounded-full text-[13px] font-semibold normal-case ${i === 1 ? 'bg-ink text-white' : 'text-ink'}`}>{d.day}</span>
            </p>
            {/* Quadrillage des heures : un trait toutes les 64 px. */}
            <div className="flex flex-1 flex-col gap-2 border-t border-line p-2 [background:repeating-linear-gradient(to_bottom,transparent_0,transparent_63px,var(--color-line)_63px,var(--color-line)_64px)]">
              {POSTS.map((p, idx) => {
                if (p.day !== i || (p.only && p.only !== scenario)) return null;
                const k = fresh.indexOf(idx);
                return <PostCard key={idx} idx={idx} labels={labels} fresh={k >= 0} start={k >= 0 ? freshStart + k * freshStep : 0.25 + 0.1 * i} />;
              })}
            </div>
          </div>
        ))}
      </div>

      <span className="demo-pop absolute end-4 bottom-4 z-10 flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white shadow-lg" style={at(toastAt)}>
        <CheckIcon size={12} />
        {t('home.demo.scheduled')}
      </span>

      {manual && <ManualComposer text={manualText} labels={labels} />}
    </div>
  );
}

/** Un canal du composeur : l'avatar du compte, son logo en badge ; un canal choisi reçoit un anneau (animation `demo-pick`). */
function ChannelTile({ logo, initials, tone, label, pickAt, dim = false }: { logo: SocialId; initials: string; tone: string; label: string; pickAt?: number; dim?: boolean }) {
  return (
    <span className="relative shrink-0" title={label}>
      <span
        className={`${pickAt !== undefined ? 'demo-pick' : ''} flex size-11 items-center justify-center rounded-full text-[13px] font-semibold text-ink/70 ${dim ? 'opacity-45' : ''}`}
        style={{ background: tone, ...(pickAt !== undefined ? at(pickAt) : {}) }}
      >
        {initials}
      </span>
      <SocialIcon id={logo} size={18} className="absolute -end-1 -bottom-1 ring-2 ring-surface" />
    </span>
  );
}

const TOOL = 'flex size-7 items-center justify-center rounded-md bg-ink/[0.05] text-[12px] text-ink/65';

/**
 * Le composeur de la planification manuelle : deux volets comme dans la vidéo « classique » (à gauche, la publication ; à droite,
 * son aperçu). Les textes viennent de la vraie application (`app.composer.*`). Le curseur choisit deux canaux, écrit le texte,
 * choisit la date puis programme.
 */
function ManualComposer({ text, labels }: { text: string; labels: DemoLabels }) {
  const t = useT();
  const life = vars({ '--d': '2.2s', '--dur': '7.7s' });
  const count = [...text].length;
  const typed = vars({ '--d': '4.6s', '--end': '99s', '--dur': '3s', '--n': count });
  return (
    <>
      <div className="demo-life absolute inset-0 z-10 bg-ink/25" style={life} />
      <div className="demo-life absolute inset-x-0 top-[36px] z-20 mx-auto w-[780px] max-w-[calc(100%-24px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl lg:grid lg:grid-cols-[1.45fr_1fr]" style={life}>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-[17px] font-semibold tracking-tight">{t('app.composer.title')}</h4>
            <span className="text-ink/50 lg:hidden"><CloseIcon /></span>
          </div>

          <p className="mt-4 text-[12.5px] font-medium">{t('app.composer.channels')}</p>
          <div className="mt-2 flex items-center gap-3">
            <ChannelTile logo="instagram" initials="ML" tone="#ffe1d6" label={`maison.lune ${t('app.composer.mediaRequired')}`} dim />
            <ChannelTile logo="facebook" initials="ML" tone="#dbe8ff" label="Maison Lune" pickAt={3.0} />
            <ChannelTile logo="x" initials="ML" tone="#e7e6e0" label="@maisonlune" pickAt={3.7} />
            <ChannelTile logo="linkedin" initials="ML" tone="#dff3e4" label="Maison Lune" />
            <ChannelTile logo="youtube" initials="ML" tone="#ece6ff" label={`Maison Lune TV ${t('app.composer.toReconnect')}`} dim />
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-dashed border-ink/25 text-ink/45" title={t('app.calendar.addChannelShort')}><PlusIcon /></span>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-paper">
            <div className="relative h-[84px] px-3 py-2.5 text-[14px]">
              <span className="demo-hide-at absolute top-2.5 start-3 text-ink/40" style={at(4.6)}>{t('app.composer.placeholder')}</span>
              <span className="demo-type" style={typed}>{text}</span>
            </div>
            <div className="flex items-center gap-1.5 border-t border-line bg-surface px-2.5 py-2">
              <span className={TOOL}><ImageIcon /></span>
              <span className={TOOL}><SmileIcon /></span>
              <span className={`${TOOL} font-bold`}>B</span>
              <span className={`${TOOL} underline`}>U</span>
              <span className="ms-auto grid text-[11.5px] text-ink/50">
                <span className="demo-hide-at col-start-1 row-start-1 text-end" style={at(7.6)}>{t('app.composer.chars', { count: 0 })}</span>
                <span className="demo-show-at col-start-1 row-start-1 text-end" style={at(7.6)}>{t('app.composer.chars', { count })}</span>
              </span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-[12.5px]">
            <span className="font-medium">{t('app.composer.date')}</span>
            <span className="relative rounded-lg border border-line px-2.5 py-1.5 whitespace-nowrap">
              <span className="demo-hide-at" style={at(8.0)}>{labels.defaultDate}</span>
              <span className="demo-show-at absolute inset-0 flex items-center justify-center rounded-lg bg-lime-soft text-forest" style={at(8.0)}>{labels.chosenDate}</span>
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="demo-press rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-white" style={at(9.3)}>{t('app.composer.schedule')}</span>
            <span className="rounded-full border border-line px-5 py-2.5 text-[13px] font-medium">{t('app.composer.draft')}</span>
          </div>
        </div>

        <aside className="hidden border-s border-line bg-paper p-5 lg:block">
          <div className="flex items-center justify-between">
            <h4 className="text-[15px] font-semibold tracking-tight">{t('home.demo.previewTitle')}</h4>
            <span className="text-ink/50"><CloseIcon /></span>
          </div>
          <div className="relative mt-4">
            <p className="demo-hide-at text-[13px] leading-snug text-ink/55" style={at(4.6)}>{t('home.demo.previewEmpty')}</p>
            <div className="demo-show-at absolute inset-x-0 top-0 rounded-xl border border-line bg-surface p-3 shadow-sm" style={at(4.6)}>
              <div className="flex items-center gap-2">
                <span className="relative size-8 shrink-0">
                  <span className="flex size-8 items-center justify-center rounded-full text-[11px] font-semibold text-ink/70" style={{ background: '#dbe8ff' }}>ML</span>
                  <SocialIcon id="facebook" size={14} className="absolute -end-1 -bottom-1 ring-2 ring-surface" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold">Maison Lune</span>
                  <span className="block text-[10.5px] text-ink/50">{labels.chosenDate}</span>
                </span>
              </div>
              <p className="mt-2.5 text-[13px] leading-snug">
                <span className="demo-type !whitespace-normal" style={typed}>{text}</span>
              </p>
            </div>
          </div>
        </aside>
      </div>

      <div className="demo-cursor-manual pointer-events-none absolute z-30 h-0 w-0 max-lg:hidden" style={{ top: 0, insetInlineStart: 0 }}>
        <CursorArrow label={t('home.demo.you')} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ onglet Inbox */

function ThreadAvatar({ thread }: { thread: DemoThread }) {
  return (
    <span className="relative size-8 shrink-0">
      <span className="flex size-8 items-center justify-center rounded-full text-[11px] font-semibold text-ink/70" style={{ background: thread.tone }}>{thread.initials}</span>
      <SocialIcon id={thread.logo} size={18} className="absolute -end-1.5 -bottom-1 ring-2 ring-surface" />
    </span>
  );
}

/** Une conversation Instagram : le client écrit, la réponse se tape et part, le client remercie. */
export function InboxScene({ labels, compact = false }: { labels: DemoLabels; compact?: boolean }) {
  const t = useT();
  const reply = t('home.demo.reply');
  const first = THREADS[0]!;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title={t('app.nav.inbox')} />
      <div className="flex min-h-0 flex-1">
        <aside className={`shrink-0 flex-col border-e border-line ${compact ? 'flex w-[216px]' : 'hidden w-[260px] md:flex'}`}>
          <div className="mx-3 mt-3 flex h-8 items-center gap-2 rounded-[10px] bg-ink/5 px-2.5 text-[13px] text-ink/40">
            <SearchIcon />
            {t('home.demo.search')}
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-3">
            {THREADS.map((thread, i) => (
              <div key={thread.name} className={`demo-row flex h-[53px] shrink-0 items-center gap-3 rounded-[10px] px-2 ${i === 0 ? 'bg-ink/[0.055]' : ''}`} style={at(i * 0.07)}>
                <ThreadAvatar thread={thread} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{thread.name}</span>
                    <span className="shrink-0 text-[11px] text-ink/45">{labels.rowTimes[i]}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] text-ink/55">{t(thread.preview)}</span>
                    {thread.unread && <span className="size-1.5 shrink-0 rounded-full bg-forest-2" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="demo-fade flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-4" style={at(0.15)}>
            <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
              <SocialIcon id={first.logo} size={16} />
              <span className="truncate">{first.name}</span>
              <span className="shrink-0 font-normal text-ink/45">· {logoName(first.logo)}</span>
            </span>
            <span className={`hidden shrink-0 items-center gap-1 rounded-full bg-lime-soft px-2.5 py-0.5 text-[11px] font-medium text-forest ${compact ? '' : 'sm:flex'}`}>
              <ClockIcon />
              {t('home.demo.replyWindow')}
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-hidden px-5 pt-4">
            <p className="demo-enter w-fit max-w-[85%] rounded-2xl rounded-ss-md bg-wash px-3.5 py-2 text-[14px] leading-snug" style={at(0.45)}>{t('home.demo.m1')}</p>
            <p className="demo-enter w-fit max-w-[85%] rounded-2xl rounded-ss-md bg-wash px-3.5 py-2 text-[14px] leading-snug" style={at(1.45)}>{t('home.demo.m2')}</p>
            <p className="demo-enter ms-auto w-fit max-w-[75%] rounded-2xl rounded-se-md bg-ink px-3.5 py-2 text-[14px] leading-snug text-white" style={at(4.25)}>{reply}</p>
            <p className="demo-enter flex items-center justify-end gap-1 text-[11px] text-ink/45" style={at(4.8)}>
              <CheckIcon size={12} />
              {t('home.demo.sent')}
            </p>
            <div className="grid">
              <div className="demo-hide-at col-start-1 row-start-1" style={at(6.6)}>
                <span className="demo-enter flex w-fit items-center gap-1 rounded-2xl rounded-ss-md bg-wash px-3.5 py-4 text-ink" style={at(5.4)}>
                  {[0, 0.15, 0.3].map((delay) => (
                    <i key={delay} className="demo-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${delay}s` }} />
                  ))}
                </span>
              </div>
              <p className="demo-enter col-start-1 row-start-1 w-fit max-w-[85%] self-start rounded-2xl rounded-ss-md bg-wash px-3.5 py-2 text-[14px] leading-snug" style={at(6.6)}>{t('home.demo.m3')}</p>
            </div>
          </div>

          <ComposerBar placeholder={t('home.demo.composer')} text={reply} typeAt={2.4} duration={1.4} sendAt={4.2} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ icônes */

const icon = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const PlusIcon = () => <svg {...icon}><path d="M8 3v10M3 8h10" /></svg>;
const SearchIcon = () => <svg {...icon}><circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3 3" /></svg>;
const ArrowUpIcon = () => <svg {...icon}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>;
const ClockIcon = () => <svg {...icon} width={12} height={12}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.2" /></svg>;
const ImageIcon = () => <svg {...icon}><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1" /><path d="m3 12 3.2-3 2.3 2 2-1.8 2.5 2.3" /></svg>;
const SmileIcon = () => <svg {...icon}><circle cx="8" cy="8" r="5.5" /><path d="M5.8 9.6a2.9 2.9 0 0 0 4.4 0M6 6.6h.01M10 6.6h.01" /></svg>;
const CloseIcon = () => <svg {...icon} width={16} height={16}><path d="m3.5 3.5 9 9m0-9-9 9" /></svg>;
const CheckIcon = ({ size = 12 }: { size?: number }) => <svg {...icon} width={size} height={size} strokeWidth={2}><path d="m3.5 8.4 3 3 6-6.4" /></svg>;
