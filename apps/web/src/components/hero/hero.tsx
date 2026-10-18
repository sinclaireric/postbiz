import Link from 'next/link';
import { HeroTitle } from '@/components/hero-title';
import { ProductShowcase } from '@/components/product-showcase';
import { ButtonLink } from '@/components/ui';
import { getLocale, getT } from '@/i18n/server';
import { demoLabels } from './demo-data';
import { HeroDemo } from './demo-window';

/** `demo` : fenêtre de démonstration de l'application (agent IA ou manuel, puis inbox) ; `video` : l'ancienne vidéo avec bascule entre deux planifications (sauvegarde). */
export type HeroMedia = 'demo' | 'video';

/**
 * Hero de l'accueil, sur le modèle de x.ai/bot : pastille, titre, sous-titre, deux boutons, puis un grand cadre.
 * L'apparition au chargement est décrite dans globals.css (`.hero-*`).
 */
export async function Hero({ media }: { media: HeroMedia }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  return (
    <section className="overflow-hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-12 px-4 pt-14 pb-16 text-center sm:gap-16 sm:px-6 sm:pt-20 sm:pb-24">
        <div className="flex flex-col items-center">
          <Link
            href="/agent"
            aria-label={`${t('home.badgeBeta')} · ${t('home.badgeLink')}`}
            className="hero-badge group mb-4 inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1.5 ps-3.5 pe-1.5 transition-colors hover:border-ink/20 sm:mb-5 sm:gap-2.5 sm:ps-4"
          >
            <span className="text-[13px] tracking-tight whitespace-nowrap">
              <span className="font-semibold">{t('home.badgeBeta')}</span>
              <span className="hidden sm:inline">
                <span className="text-ink/30"> • </span>
                <span className="text-muted transition-colors group-hover:text-ink">{t('home.badgeLink')}</span>
              </span>
            </span>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink transition-colors group-hover:bg-ink/10" aria-hidden="true">
              <svg className="size-3 rtl:-scale-x-100" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 11 11 5M6.5 5H11v4.5" /></svg>
            </span>
          </Link>

          <HeroTitle className="max-w-5xl text-[clamp(2.4rem,5vw,4rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance" />
          <p className="hero-copy mt-4 max-w-xl text-base leading-relaxed text-pretty text-muted sm:mt-5 sm:max-w-2xl sm:text-lg">{t('home.subtitle')}</p>

          <div className="hero-actions mt-6 flex flex-col items-center gap-3 sm:mt-7">
            <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
              <ButtonLink href="/signup" size="lg">{t('home.ctaPrimary')}</ButtonLink>
              <ButtonLink href="/tarifs" variant="secondary" size="lg">{t('home.ctaPricing')}</ButtonLink>
            </div>
            <p className="text-sm text-subtle">{t('home.betaNote')}</p>
          </div>
        </div>

        <div className="hero-frame w-full">
          {media === 'demo' ? <HeroDemo labels={demoLabels(locale)} /> : <ProductShowcase />}
        </div>
      </div>
    </section>
  );
}
