import Link from 'next/link';
import { EndBand, Faq, SECTION_H2, StatusPill } from '@/components/agents/agents-ui';
import { InboxPreview } from '@/components/inbox-preview';
import { RichText, accentLimeTags } from '@/components/rich-text';
import { ButtonLink, Container } from '@/components/ui';
import { getT } from '@/i18n/server';
import { AI_AGENTS } from '@/lib/agents';
import { NETWORKS, capabilityKey, networkName, networkNoteKey, type Capability, type Network } from '@/lib/networks';

const tone = (c: Capability) => (c === 'beta' ? 'beta' : 'soon');

/** Page d'un canal (réseau social) : ce que Postbiz fait aujourd'hui sur ce réseau, sans rien promettre de plus. */
export async function ChannelPage({ network }: { network: Network }) {
  const t = await getT();
  const name = networkName(network.id);
  const icon = `/socials/${network.id}.svg`;

  // Publication pas encore disponible sur ce réseau : la page le dit au lieu de promettre un envoi à l'heure choisie.
  const publishSoon = network.publish !== 'beta';
  const inbox: 'both' | 'comments' | 'soon' =
    network.dm === 'beta' && network.comments === 'beta' ? 'both' : network.comments === 'beta' ? 'comments' : 'soon';

  const status = [
    { label: t('channelsPage.publish'), cap: network.publish },
    { label: t('channelsPage.dm'), cap: network.dm },
    { label: t('channelsPage.comments'), cap: network.comments },
  ];
  const cards = [
    publishSoon
      ? { title: t('channelPage.c1Soon.title'), text: t('channelPage.c1Soon.text', { network: name }) }
      : { title: t('channelPage.c1.title'), text: t('channelPage.c1.text', { network: name }) },
    { title: t('channelPage.c2.title'), text: t('channelPage.c2.text', { network: name }) },
    { title: t(`channelPage.inbox.${inbox}.title`), text: t(`channelPage.inbox.${inbox}.text`, { network: name }) },
    { title: t('channelPage.c4.title'), text: t('channelPage.c4.text', { network: name }) },
  ];
  const faq = [
    { q: t('channelPage.faq.q1', { network: name }), a: t(publishSoon ? 'channelPage.faq.a1Soon' : 'channelPage.faq.a1', { network: name }) },
    { q: t('channelPage.faq.q2', { network: name }), a: `${t(networkNoteKey(network.id))} ${t('channelPage.faq.a2')}` },
    { q: t('channelPage.faq.q3'), a: t('channelPage.faq.a3') },
    { q: t('channelPage.faq.q4', { network: name }), a: t('channelPage.faq.a4') },
    { q: t('channelPage.faq.q5', { network: name }), a: t('channelPage.faq.a5') },
  ];

  return (
    <>
      <section className="pattern-diamonds text-white">
        <Container className="flex flex-col items-center py-20 text-center sm:py-28">
          <div className="flex flex-col items-center">
            <span className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
              <img src={icon} alt="" width={36} height={36} className="h-9 w-9 rounded-[22%]" />
              <span className="text-xl font-semibold tracking-wide uppercase">{name}</span>
            </span>
            <svg width="132" height="12" viewBox="0 0 132 12" fill="none" aria-hidden="true" className="mt-1.5 text-lime">
              <path d="M2 7c14-6 24 6 38 0s24-6 38 0 24 6 38 0 10-3 14-2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="mt-7 max-w-4xl text-[clamp(2.4rem,5.4vw,4.5rem)] leading-[1.04] font-extrabold tracking-[-0.035em] text-balance">
            {t(publishSoon ? 'channelPage.titleSoon' : 'channelPage.title', { network: name })}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">{t(`channelPage.lead.${network.id}`)}</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup" variant="lime" size="lg">{t('header.tryFree')}</ButtonLink>
            <Link href="#etat" className="inline-flex h-12 items-center justify-center rounded-full border border-white/25 px-6 text-base font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/10">{t('channelPage.ctaStatus')}</Link>
          </div>
        </Container>
      </section>

      <section id="etat" className="scroll-mt-20 py-20 sm:py-24">
        <Container>
          <h2 className={`${SECTION_H2} max-w-3xl`}>{t('channelPage.status.title', { network: name })}</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {status.map((s) => (
              <article key={s.label} className="rounded-3xl border border-line bg-surface p-6">
                <p className="text-sm font-medium text-muted">{s.label}</p>
                <div className="mt-3"><StatusPill tone={tone(s.cap)}>{t(capabilityKey(s.cap))}</StatusPill></div>
              </article>
            ))}
          </div>
          <p className="mt-6 max-w-3xl leading-relaxed text-muted">{t(networkNoteKey(network.id))}</p>
          <p className="mt-2 max-w-3xl text-sm text-subtle">{t('channelsPage.footnote')}</p>
        </Container>
      </section>

      <section className="border-y border-line bg-wash/60 py-20 sm:py-24">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c) => (
              <article key={c.title} className="rounded-3xl border border-line bg-surface p-7">
                <h3 className="text-xl font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{c.text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div>
            <h2 className={SECTION_H2}>{t('channelPage.visual.title')}</h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">{t('channelPage.visual.text', { network: name })}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/produit/inbox" variant="secondary" size="md">{t('footer.inbox')}</ButtonLink>
              <ButtonLink href="/produit/planification" variant="secondary" size="md">{t('footer.planning')}</ButtonLink>
            </div>
          </div>
          <div className="pattern-diamonds flex items-center justify-center overflow-hidden rounded-[2rem] px-5 py-12 sm:px-10">
            <InboxPreview className="w-full max-w-[560px]" />
          </div>
        </Container>
      </section>

      <section className="pb-20 sm:pb-24">
        <Container>
          <div className="flex flex-col gap-6 rounded-3xl border border-line bg-surface p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9">
            <div className="max-w-xl">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">{t('channelPage.agents.title', { network: name })}</h2>
                <StatusPill tone="soon">{t('common.capability.soon')}</StatusPill>
              </div>
              <p className="mt-3 leading-relaxed text-muted">{t('channelPage.agents.text')}</p>
              <Link href="/agent" className="mt-4 inline-block font-semibold underline underline-offset-4">{t('agents.fineLink')}</Link>
            </div>
            <div className="flex -space-x-2 rtl:space-x-reverse" aria-hidden="true">
              {AI_AGENTS.filter((a) => ['claude', 'chatgpt', 'claude-code', 'cursor', 'codex'].includes(a.slug)).map((a) => (
                // eslint-disable-next-line @next/next/no-img-element -- petit SVG statique
                <img key={a.slug} src={a.icon} alt="" width={44} height={44} className="h-11 w-11 rounded-[27%] ring-2 ring-surface" loading="lazy" />
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section className="border-t border-line py-20 sm:py-24">
        <Container className="max-w-3xl">
          <h2 className={SECTION_H2}>{t('channelPage.faq.title', { network: name })}</h2>
          <div className="mt-8"><Faq items={faq} /></div>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <h2 className="text-2xl font-bold tracking-[-0.02em]">{t('channelPage.others.title')}</h2>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {NETWORKS.filter((n) => n.id !== network.id).map((n) => (
              <li key={n.id}>
                <Link href={`/canaux/${n.id}`} className="flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 transition-colors hover:border-ink/30 hover:bg-wash">
                  {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
                  <img src={`/socials/${n.id}.svg`} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-[20%]" loading="lazy" />
                  <span className="truncate text-[15px] font-semibold">{networkName(n.id)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <EndBand title={<RichText t={t} k="channelPage.end.title" params={{ network: name }} tags={accentLimeTags} />} text={t('channelPage.end.text')} button={t('header.tryFree')} />
    </>
  );
}
