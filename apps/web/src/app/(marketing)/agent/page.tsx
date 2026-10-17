import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentGrid, EndBand, SECTION_H2, StatusPill } from '@/components/agents/agents-ui';
import { RichText, accentLimeTags, accentTags } from '@/components/rich-text';
import { ButtonLink, Container } from '@/components/ui';
import { getT } from '@/i18n/server';
import { AI_AGENTS } from '@/lib/agents';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.agents.title'), description: t('meta.agents.description'), alternates: { canonical: '/agent' } };
}

export default async function AgentsHubPage() {
  const t = await getT();
  const soon = t('common.capability.soon');
  const routes = [
    { icon: '/agents/mcp.svg', title: t('agents.hub.mcp.title'), text: t('agents.hub.mcp.text'), href: '/mcp' },
    { icon: '/agents/terminal.svg', title: t('agents.hub.cli.title'), text: t('agents.hub.cli.text') },
    { icon: '/agents/api.svg', title: t('agents.hub.api.title'), text: t('agents.hub.api.text') },
  ];

  return (
    <>
      <section className="pattern-diamonds text-white">
        <Container className="py-20 sm:py-28">
          <div className="flex -space-x-2 rtl:space-x-reverse" aria-hidden="true">
            {AI_AGENTS.slice(0, 8).map((a) => (
              // eslint-disable-next-line @next/next/no-img-element -- petit SVG statique
              <img key={a.slug} src={a.icon} alt="" width={40} height={40} className="h-10 w-10 rounded-[27%] ring-2 ring-forest" />
            ))}
          </div>
          <h1 className="mt-8 max-w-4xl text-[clamp(2.4rem,5.2vw,4.25rem)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance">
            <RichText t={t} k="agents.hub.title" tags={accentLimeTags} />
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">{t('agents.hub.intro')}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/signup" variant="lime" size="lg">{t('header.tryFree')}</ButtonLink>
            <Link href="/blog/category/agents" className="inline-flex h-12 items-center justify-center rounded-full border border-white/25 px-6 text-base font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/10">{t('agents.hub.guides')}</Link>
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container>
          <h2 className={`${SECTION_H2} max-w-3xl`}>
            <RichText t={t} k="agents.hub.routesTitle" tags={accentTags} />
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {routes.map((r) => {
              const body = (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
                  <img src={r.icon} alt="" width={40} height={40} className="h-10 w-10 rounded-[27%]" />
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold tracking-tight">{r.title}</h3>
                    <StatusPill tone="soon">{soon}</StatusPill>
                  </div>
                  <p className="mt-3 leading-relaxed text-muted">{r.text}</p>
                </>
              );
              const cls = 'block rounded-3xl border border-line bg-surface p-7';
              return r.href ? (
                <Link key={r.title} href={r.href} className={`${cls} transition-colors hover:bg-wash`}>{body}</Link>
              ) : (
                <article key={r.title} className={cls}>{body}</article>
              );
            })}
          </div>
        </Container>
      </section>

      <section className="border-t border-line pt-20 pb-20 sm:pt-24">
        <Container>
          <h2 className={`${SECTION_H2} max-w-3xl`}>{t('agents.hub.listTitle')}</h2>
          <p className="mt-4 max-w-2xl text-lg text-muted">{t('agents.hub.listText')}</p>
          <div className="mt-8"><AgentGrid soon={soon} /></div>
        </Container>
      </section>

      <EndBand title={<RichText t={t} k="agents.end.title" tags={accentLimeTags} />} text={t('agents.end.text')} button={t('header.tryFree')} />
    </>
  );
}
