import Link from 'next/link';
import { Hero, type HeroMedia } from '@/components/hero/hero';
import { InboxPreview } from '@/components/inbox-preview';
import { RichText, accentLimeTags, accentTags } from '@/components/rich-text';
import { Badge, ButtonLink, Container, Eyebrow } from '@/components/ui';
import { SocialIcon, socialName, type SocialId } from '@/components/social-icon';
import { LOCALE_META } from '@/i18n/config';
import { getLocale, getT } from '@/i18n/server';
import { NETWORKS, networkName } from '@/lib/networks';

/** Média du hero : `demo` = démonstration animée de l'application (modèle x.ai/bot), `video` = ancienne vidéo avec bascule entre deux planifications (gardée en sauvegarde). */
const HERO_MEDIA: HeroMedia = 'demo';

const H2 = 'mt-3 max-w-3xl text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]';

/** Les messageries soumises à la fenêtre de 24 heures, avec leur logo (le texte de l'intitulé est composé selon la langue : « A, B et C »). */
const WINDOW_APPS: SocialId[] = ['messenger', 'instagram', 'whatsapp'];

export default async function HomePage() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const windowApps = new Intl.ListFormat(LOCALE_META[locale].tag, { style: 'long', type: 'conjunction' }).format(WINDOW_APPS.map(socialName));

  const pillars = [
    { title: t('home.pillars.publish.title'), text: t('home.pillars.publish.text') },
    { title: t('home.pillars.reply.title'), text: t('home.pillars.reply.text') },
    { title: t('home.pillars.collaborate.title'), text: t('home.pillars.collaborate.text') },
  ];
  const steps = [
    { n: '01', title: t('home.steps.s1.title'), text: t('home.steps.s1.text') },
    { n: '02', title: t('home.steps.s2.title'), text: t('home.steps.s2.text') },
    { n: '03', title: t('home.steps.s3.title'), text: t('home.steps.s3.text') },
    { n: '04', title: t('home.steps.s4.title'), text: t('home.steps.s4.text') },
  ];
  const features = [
    { title: t('home.features.inbox.title'), text: t('home.features.inbox.text'), beta: true },
    { title: t('home.features.calendar.title'), text: t('home.features.calendar.text'), beta: true },
    { title: t('home.features.media.title'), text: t('home.features.media.text'), beta: false },
    { title: t('home.features.team.title'), text: t('home.features.team.text'), beta: true },
    { title: t('home.features.mobile.title'), text: t('home.features.mobile.text'), beta: false },
    { title: t('home.features.stats.title'), text: t('home.features.stats.text'), beta: false },
  ];
  const trust = [
    { title: t('home.trust.isolation.title'), text: t('home.trust.isolation.text') },
    { title: t('home.trust.tokens.title'), text: t('home.trust.tokens.text') },
    { title: t('home.trust.openSource.title'), text: t('home.trust.openSource.text') },
  ];
  const faq = [
    { q: t('home.faq.q1'), a: t('home.faq.a1') },
    { q: t('home.faq.q2'), a: t('home.faq.a2') },
    { q: t('home.faq.q3'), a: t('home.faq.a3') },
    { q: t('home.faq.q4'), a: t('home.faq.a4') },
    { q: t('home.faq.q5'), a: t('home.faq.a5') },
    { q: t('home.faq.q6'), a: t('home.faq.a6') },
  ];
  const windowPoints = [t('home.window.point1'), t('home.window.point2'), t('home.window.point3')];

  return (
    <>
      <Hero media={HERO_MEDIA} />

      {/* TROIS PILIERS */}
      <section className="py-20 sm:py-28">
        <Container>
          <Eyebrow>{t('home.pillars.eyebrow')}</Eyebrow>
          <h2 className={H2}><RichText t={t} k="home.pillars.title" tags={accentTags} /></h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {pillars.map((p, i) => (
              <article key={p.title} className="flex min-h-[260px] flex-col justify-between rounded-3xl border border-line bg-surface p-7">
                <span className="text-sm font-semibold text-subtle">0{i + 1}</span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight">{p.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{p.text}</p>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* FENÊTRE 24 H */}
      <section className="pattern-diamonds text-white">
        <Container className="grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex gap-1.5" aria-hidden="true">
                {WINDOW_APPS.map((id) => <SocialIcon key={id} id={id} size={26} />)}
              </span>
              <Eyebrow className="!text-lime">{windowApps}</Eyebrow>
            </div>
            <h2 className={H2}><RichText t={t} k="home.window.title" tags={accentLimeTags} /></h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/80">{t('home.window.text')}</p>
            <ul className="mt-8 grid gap-3 text-white/90">
              {windowPoints.map((p) => (
                <li key={p} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-lime text-forest">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m2.5 6.2 2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <InboxPreview />
        </Container>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="py-20 sm:py-28">
        <Container>
          <Eyebrow>{t('home.steps.eyebrow')}</Eyebrow>
          <h2 className={H2}><RichText t={t} k="home.steps.title" tags={accentTags} /></h2>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n} className="rounded-3xl border border-line bg-surface p-6">
                <p className="text-sm font-bold text-forest-2">{s.n}</p>
                <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* FONCTIONNALITÉS */}
      <section className="border-y border-line bg-wash py-20 sm:py-28">
        <Container>
          <Eyebrow>{t('home.features.eyebrow')}</Eyebrow>
          <h2 className={H2}><RichText t={t} k="home.features.title" tags={accentTags} /></h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <article key={f.title} className="bg-surface p-7">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  {f.beta ? <Badge tone="lime">{t('common.capability.beta')}</Badge> : <Badge>{t('common.capability.soon')}</Badge>}
                </div>
                <p className="mt-3 leading-relaxed text-muted">{f.text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* CANAUX */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <Eyebrow>{t('home.channels.eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]"><RichText t={t} k="home.channels.title" tags={accentTags} /></h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">{t('home.channels.text')}</p>
            <ButtonLink href="/canaux" variant="secondary" className="mt-8">{t('home.channels.cta')}</ButtonLink>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NETWORKS.map((n) => (
              <li key={n.id} className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-4">
                <SocialIcon id={n.id} size={36} />
                <span className="font-semibold">{networkName(n.id)}</span>
              </li>
            ))}
            {/* WhatsApp : pas encore un canal de Postbiz, annoncé comme tel (pas de pastille « bêta »). */}
            <li className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line bg-surface px-4 py-4">
              <SocialIcon id="whatsapp" size={36} />
              <span className="font-semibold">{socialName('whatsapp')}</span>
              <Badge>{t('common.capability.soon')}</Badge>
            </li>
          </ul>
        </Container>
      </section>

      {/* CONFIANCE */}
      <section className="border-y border-line bg-wash py-20 sm:py-28">
        <Container>
          <Eyebrow>{t('home.trust.eyebrow')}</Eyebrow>
          <h2 className={H2}><RichText t={t} k="home.trust.title" tags={accentTags} /></h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {trust.map((x) => (
              <article key={x.title} className="rounded-3xl border border-line bg-surface p-7">
                <h3 className="text-lg font-semibold">{x.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{x.text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <Eyebrow>{t('home.faq.eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]"><RichText t={t} k="home.faq.title" tags={accentTags} /></h2>
            <p className="mt-4 text-muted">
              <RichText t={t} k="home.faq.more" tags={{ link: (text) => <Link href="/contact" className="font-semibold text-ink underline underline-offset-4">{text}</Link> }} />
            </p>
          </div>
          <div className="divide-y divide-line rounded-3xl border border-line bg-surface">
            {faq.map((f) => (
              <details key={f.q} className="group px-6 py-5">
                <summary className="flex items-center justify-between gap-4 text-[17px] font-semibold">
                  {f.q}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-wash transition group-open:rotate-45" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      {/* APPEL À L'ACTION */}
      <section className="px-5 pb-20 sm:px-8 sm:pb-28">
        <div className="pattern-diamonds mx-auto max-w-[1200px] overflow-hidden rounded-[2rem] px-6 py-16 text-center text-white sm:px-12 sm:py-24">
          <h2 className="mx-auto max-w-2xl text-[clamp(2rem,4vw,3.25rem)] leading-[1.08] font-semibold tracking-[-0.035em]">
            <RichText t={t} k="home.final.title" tags={accentLimeTags} />
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg text-white/80">{t('home.final.text')}</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup" variant="lime" size="lg">{t('home.final.cta')}</ButtonLink>
            <ButtonLink href="/contact" variant="secondary" size="lg">{t('home.final.talk')}</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
