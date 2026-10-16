import type { ReactNode } from 'react';
import { getT } from '@/i18n/server';
import { ButtonLink, Container, Eyebrow } from './ui';

export async function ProductPage({
  eyebrow, title, intro, points, visual, ctaTitle,
}: {
  eyebrow: string;
  title: ReactNode;
  intro: string;
  points: { title: string; text: string }[];
  visual: ReactNode;
  ctaTitle: string;
}) {
  const t = await getT();
  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
          <div className="flex flex-col justify-center px-5 py-16 sm:px-10 lg:py-24 xl:ps-[max(2.5rem,calc((100vw-1200px)/2+2rem))] xl:pe-16">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="mt-3 text-[clamp(2.3rem,4.8vw,3.8rem)] leading-[1.05] font-semibold tracking-[-0.035em]">{title}</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{intro}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg">{t('productPage.ctaPrimary')}</ButtonLink>
              <ButtonLink href="/tarifs" variant="secondary" size="lg">{t('productPage.ctaPricing')}</ButtonLink>
            </div>
          </div>
          <div className="pattern-diamonds flex min-h-[380px] items-center justify-center overflow-hidden px-5 py-14 sm:px-10 lg:min-h-[560px]">{visual}</div>
        </div>
      </section>
      <section className="py-20 sm:py-24">
        <Container className="grid gap-4 md:grid-cols-3">
          {points.map((p) => (
            <article key={p.title} className="rounded-3xl border border-line bg-surface p-7">
              <h2 className="text-xl font-semibold tracking-tight">{p.title}</h2>
              <p className="mt-3 leading-relaxed text-muted">{p.text}</p>
            </article>
          ))}
        </Container>
      </section>
      <section className="px-5 pb-20 sm:px-8 sm:pb-28">
        <div className="mx-auto max-w-[1200px] rounded-[2rem] bg-ink px-6 py-14 text-center text-white sm:py-20">
          <h2 className="mx-auto max-w-xl text-[clamp(1.8rem,3.4vw,2.6rem)] leading-[1.1] font-semibold tracking-[-0.03em]">{ctaTitle}</h2>
          <ButtonLink href="/signup" variant="lime" size="lg" className="mt-8">{t('productPage.ctaPrimary')}</ButtonLink>
        </div>
      </section>
    </>
  );
}
