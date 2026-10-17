import Link from 'next/link';
import { getT } from '@/i18n/server';
import { NETWORKS } from '@/lib/networks';
import { RichText, accentLimeTags } from '../rich-text';
import { LogoMark } from '../logo';
import { NetworkDot } from '../app/network-dot';
import { ButtonLink } from '../ui';

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-forest">
    <circle cx="8" cy="8" r="8" fill="currentColor" />
    <path d="m4.8 8.2 2.2 2.2 4.2-4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Les six réseaux en arc autour du logo, dans un cadre clair : l'illustration de la carte, sans image à charger. */
function Orbit() {
  const angles = [-80, -48, -16, 16, 48, 80];
  return (
    <div aria-hidden="true" dir="ltr" className="relative h-[156px] overflow-hidden rounded-lg bg-wash">
      <div className="absolute bottom-0 left-1/2 h-[70px] w-[46px] -translate-x-1/2 rounded-t-full bg-gradient-to-b from-lime to-forest" />
      <div className="absolute bottom-[38px] left-1/2 flex h-[52px] w-[52px] -translate-x-1/2 items-center justify-center rounded-full bg-surface shadow-md ring-1 ring-line">
        <LogoMark size={32} />
      </div>
      {NETWORKS.map((n, i) => (
        <span
          key={n.id}
          className="absolute bottom-[48px] left-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-surface shadow-sm ring-1 ring-line"
          style={{ transform: `translateX(-50%) rotate(${angles[i]}deg) translateY(-72px) rotate(${-angles[i]!}deg)` }}
        >
          <NetworkDot id={n.id} size={12} />
        </span>
      ))}
    </div>
  );
}

/** Carte de la colonne de droite d'un article, sous le sommaire. */
export async function PostCtaCard() {
  const t = await getT();
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-xs">
      <Orbit />
      <div className="px-2 pt-5 pb-2">
        <p className="text-base font-semibold">{t('blog.cta.title')}</p>
        <ul className="mt-4 grid gap-2 text-sm">
          {([t('blog.cta.point1'), t('blog.cta.point2')] as const).map((p) => (
            <li key={p} className="flex items-center gap-2"><Check />{p}</li>
          ))}
        </ul>
        <ButtonLink href="/signup" size="lg" className="mt-5 w-full shadow-[0_4px_0_-1px_var(--color-lime)]">{t('blog.cta.button')}</ButtonLink>
      </div>
    </div>
  );
}

/** Grande carte de fin d'article : panneau vert à losanges, comme sur la page d'accueil. */
export async function EndCta() {
  const t = await getT();
  return (
    <section className="pattern-diamonds overflow-hidden rounded-3xl px-7 py-12 text-white sm:px-12 sm:py-16">
      <h2 className="max-w-[18ch] text-[clamp(1.9rem,4vw,3rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
        <RichText t={t} k="blog.cta.endTitle" tags={accentLimeTags} />
      </h2>
      <p className="mt-4 max-w-xl text-lg text-white/80">{t('blog.cta.endText')}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/signup" variant="lime" size="lg">{t('blog.cta.endButton')}</ButtonLink>
        <Link href="/produit/inbox" className="inline-flex h-12 items-center justify-center rounded-full border border-white/25 px-6 text-base font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/10">{t('blog.cta.endSecondary')}</Link>
      </div>
    </section>
  );
}
