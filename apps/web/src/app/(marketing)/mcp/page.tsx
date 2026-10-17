import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentGrid, EndBand, SECTION_H2, StatusPill } from '@/components/agents/agents-ui';
import { RichText, accentLimeTags } from '@/components/rich-text';
import { ButtonLink, Container } from '@/components/ui';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.mcp.title'), description: t('meta.mcp.description'), alternates: { canonical: '/mcp' } };
}

export default async function McpPage() {
  const t = await getT();
  const cards = [
    { title: t('agents.mcp.c1.title'), text: t('agents.mcp.c1.text') },
    { title: t('agents.mcp.c2.title'), text: t('agents.mcp.c2.text') },
    { title: t('agents.mcp.c3.title'), text: t('agents.mcp.c3.text') },
  ];
  return (
    <>
      <section className="pattern-diamonds text-white">
        <Container className="py-20 sm:py-28">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
            <img src="/agents/mcp.svg" alt="" width={44} height={44} className="h-11 w-11 rounded-[27%] ring-1 ring-white/25" />
            <StatusPill tone="soon">{t('common.capability.soon')}</StatusPill>
          </div>
          <h1 className="mt-7 max-w-4xl text-[clamp(2.4rem,5.2vw,4.25rem)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance">
            <RichText t={t} k="agents.mcp.title" tags={accentLimeTags} />
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">{t('agents.mcp.intro')}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/signup" variant="lime" size="lg">{t('header.tryFree')}</ButtonLink>
            <Link href="/agent" className="inline-flex h-12 items-center justify-center rounded-full border border-white/25 px-6 text-base font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/10">{t('agents.mcp.all')}</Link>
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container>
          <div className="grid gap-4 md:grid-cols-3">
            {cards.map((c) => (
              <article key={c.title} className="rounded-3xl border border-line bg-surface p-7">
                <h2 className="text-xl font-semibold tracking-tight">{c.title}</h2>
                <p className="mt-3 leading-relaxed text-muted">{c.text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line pt-20 pb-20 sm:pt-24">
        <Container>
          <h2 className={`${SECTION_H2} max-w-3xl`}>{t('agents.hub.listTitle')}</h2>
          <div className="mt-8"><AgentGrid soon={t('common.capability.soon')} /></div>
        </Container>
      </section>

      <EndBand title={<RichText t={t} k="agents.end.title" tags={accentLimeTags} />} text={t('agents.end.text')} button={t('header.tryFree')} />
    </>
  );
}
