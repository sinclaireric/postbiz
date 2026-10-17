import Link from 'next/link';
import type { ReactNode } from 'react';
import { THEMES, type AgentTheme } from '@/lib/agents';
import { HeroVideo } from './hero-video';

/** Pastilles de réseaux autour de la mascotte : position, inclinaison, retard et durée propres à chacune. */
const TILES = [
  { id: 'facebook', alt: 'Facebook', left: 62, top: 2, tilt: 6, delay: 0.2, dur: 7.3 },
  { id: 'linkedin', alt: 'LinkedIn', left: 84, top: 10, tilt: 8, delay: 2.1, dur: 6.8 },
  { id: 'x', alt: 'X', left: 16, top: 32, tilt: -4, delay: 0.6, dur: 6 },
  { id: 'tiktok', alt: 'TikTok', left: 88, top: 38, tilt: -6, delay: 0.3, dur: 7.4 },
  { id: 'youtube', alt: 'YouTube', left: 2, top: 60, tilt: 5, delay: 1.7, dur: 6.2 },
  { id: 'instagram', alt: 'Instagram', left: 78, top: 88, tilt: -5, delay: 1.4, dur: 6.9 },
] as const;

export interface HeroAction {
  label: string;
  href: string;
  primary?: boolean;
}

/**
 * Hero d'une page d'agent : dégradé de la couleur de l'agent, texte à gauche, à droite la vidéo de mascotte en boucle
 * entourée de pastilles de réseaux qui flottent.
 */
export function AgentHero({
  theme, icon, iconAlt, badge, title, bullets, actions, fineprint, media,
}: {
  theme: AgentTheme;
  icon: string;
  iconAlt: string;
  badge: string;
  title: string;
  bullets: string[];
  actions: HeroAction[];
  fineprint?: ReactNode;
  /** Nom des médias dans public/agents/hero/ (sans extension) : `<media>.webm` et `<media>.webp`. */
  media: string;
}) {
  const colors = THEMES[theme];
  const poster = `/agents/hero/${media}.webp`;
  return (
    <section className="relative overflow-hidden text-white" style={{ background: colors.bg }}>
      <div className="mx-auto grid max-w-[1360px] grid-cols-1 items-center gap-12 px-5 pt-14 pb-12 sm:pt-20 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-8">
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
            <img src={icon} alt={iconAlt} width={44} height={44} draggable={false} className="h-11 w-11 shrink-0 rounded-[27%] ring-1 ring-white/25 ring-inset select-none" />
            <span className="text-[15px] font-semibold text-white/90 sm:text-base">{badge}</span>
          </div>
          <h1 className="mt-7 text-start text-[42px] leading-[46px] font-extrabold tracking-[-0.03em] sm:text-[64px] sm:leading-[68px]">{title}</h1>
          <ul className="mt-7 space-y-3 text-[17px] leading-6 text-white/90 sm:text-[19px] sm:leading-[27px]">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-[10px] h-[7px] w-[7px] shrink-0 rounded-[2px] bg-lime" />
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-9 flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className={`inline-flex h-[52px] items-center justify-center rounded-full px-7 text-[16px] font-medium whitespace-nowrap transition-colors sm:h-14 sm:px-8 sm:text-[19px] ${
                  a.primary ? 'bg-white text-black hover:bg-lime' : 'border border-white text-white hover:border-lime hover:text-lime'
                }`}
              >
                {a.label}
              </Link>
            ))}
          </div>
          {fineprint && <div className="mt-7 max-w-xl text-[13px] leading-[18px] text-white/70 [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-white">{fineprint}</div>}
        </div>

        <div dir="ltr" className="relative h-[300px] w-full sm:h-[420px] lg:h-[540px]" aria-hidden="true">
          {TILES.map((tile, i) => (
            <span
              key={tile.id}
              className={`float-tile absolute z-10 ${i > 3 ? 'hidden sm:block' : 'block'}`}
              style={{ left: `${tile.left}%`, top: `${tile.top}%`, ['--tilt' as string]: `${tile.tilt}deg`, ['--delay' as string]: `${tile.delay}s`, ['--dur' as string]: `${tile.dur}s` }}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-[22%] bg-white shadow-[0_14px_30px_rgba(10,0,40,0.35)] sm:h-[72px] sm:w-[72px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
                <img src={`/socials/${tile.id}.svg`} alt="" width={44} height={44} className="rounded-[20%]" loading="lazy" />
              </span>
            </span>
          ))}
          {/* Halo de la couleur de l'agent derrière la mascotte */}
          <div className="absolute top-[54%] left-1/2 h-[75%] w-[75%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-[40px]" style={{ background: colors.glow }} />
          <div className="absolute top-[54%] left-1/2 w-[269px] -translate-x-1/2 -translate-y-1/2 sm:w-[381px] lg:w-[471px]">
            {/* Ombre : l'affiche en noir, floutée, décalée vers le bas */}
            {/* eslint-disable-next-line @next/next/no-img-element -- affiche statique */}
            <img src={poster} alt="" className="absolute inset-0 h-auto w-full translate-y-[30px] opacity-45 blur-[25px] brightness-0" />
            <div className="relative aspect-square w-full">
              <HeroVideo src={`/agents/hero/${media}.webm`} poster={poster} className="absolute inset-0 h-full w-full" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
