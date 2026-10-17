import Link from 'next/link';
import { PostCard } from '@/components/blog/post-card';
import { getT } from '@/i18n/server';
import { contentLocaleFor } from '@/lib/blog/logic';
import { getPost } from '@/lib/blog/server';
import type { Post } from '@/lib/blog/types';
import type { AiAgent } from '@/lib/agents';
import { NETWORKS, capabilityKey, networkName } from '@/lib/networks';
import { RichText, accentLimeTags } from '../rich-text';
import { Container } from '../ui';
import { AgentHero } from './agent-hero';
import { AgentGrid, EndBand, Faq, SECTION_H2, StatusPill } from './agents-ui';

/** Page d'un agent : hero animé, étapes, ce que l'agent pourra faire, présentation, réseaux, questions. */
export async function AgentPage({ agent }: { agent: AiAgent }) {
  const t = await getT();
  const name = agent.name;
  const what = agent.what[contentLocaleFor(t.locale)];
  const foreignWhat = t.locale !== 'fr' && t.locale !== 'en' ? 'en' : undefined;

  const [workflow, brief] = await Promise.all([getPost(t.locale, 'ai-agent-social-media-workflow'), getPost(t.locale, 'brief-for-ai-agent')]);
  const guides = [workflow, brief].filter((p): p is Post => !!p);

  const steps = [
    { n: '1', title: t('agents.how.s1.title'), text: t('agents.how.s1.text'), tone: 'ok' as const, status: t('agents.available') },
    { n: '2', title: t('agents.how.s2.title', { name }), text: t('agents.how.s2.text'), tone: 'soon' as const, status: t('common.capability.soon') },
    { n: '3', title: t('agents.how.s3.title'), text: t('agents.how.s3.text', { name }), tone: 'soon' as const, status: t('common.capability.soon') },
  ];
  const can = [
    { title: t('agents.can.c1.title'), text: t('agents.can.c1.text') },
    { title: t('agents.can.c2.title'), text: t('agents.can.c2.text') },
    { title: t('agents.can.c3.title'), text: t('agents.can.c3.text') },
    { title: t('agents.can.c4.title'), text: t('agents.can.c4.text') },
  ];
  const faq = [
    { q: t('agents.faq.q1', { name }), a: what, lang: foreignWhat },
    { q: t('agents.faq.q2', { name }), a: t('agents.faq.a2', { name }) },
    { q: t('agents.faq.q3'), a: t('agents.faq.a3') },
    { q: t('agents.faq.q4', { name }), a: t('agents.faq.a4', { name }) },
    { q: t('agents.faq.q5', { name }), a: t('agents.faq.a5') },
  ];

  return (
    <>
      <AgentHero
        theme={agent.theme}
        icon={agent.icon}
        iconAlt={name}
        badge={t('agents.badge', { name })}
        title={t('agents.title', { name })}
        bullets={[t('agents.bullet1', { name }), t('agents.bullet2'), t(`agents.kind.${agent.kind}.bullet`)]}
        actions={[
          { label: t('header.tryFree'), href: '/signup', primary: true },
          { label: t('agents.howCta'), href: '#comment' },
        ]}
        fineprint={
          <p>
            {t('agents.fine', { name })}{' '}
            <Link href="/agent">{t('agents.fineLink')}</Link>
          </p>
        }
        media={agent.slug}
      />

      <section id="comment" className="scroll-mt-20 py-20 sm:py-24">
        <Container>
          <h2 className={`${SECTION_H2} max-w-3xl`}>{t('agents.how.title', { name })}</h2>
          <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <ol className="grid gap-4">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-4 rounded-3xl border border-line bg-surface p-6">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{s.n}</span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                      <StatusPill tone={s.tone}>{s.status}</StatusPill>
                    </div>
                    <p className="mt-2 leading-relaxed text-muted">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            {/* Conversation d'exemple, clairement présentée comme une illustration */}
            <figure className="flex flex-col rounded-3xl bg-ink p-6 text-white">
              <figcaption className="flex items-center gap-3 text-sm text-white/70">
                {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
                <img src={agent.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-[27%]" />
                <span className="font-semibold text-white">{name}</span>
                <StatusPill tone="soon">{t('agents.demo.badge')}</StatusPill>
              </figcaption>
              <div className="mt-5 grid gap-3 text-[15px] leading-relaxed">
                <p className="max-w-[88%] self-end rounded-2xl rounded-ee-md bg-white/10 px-4 py-3">{t('agents.demo.user')}</p>
                <p className="max-w-[92%] self-start rounded-2xl rounded-es-md bg-lime px-4 py-3 text-ink">{t('agents.demo.agent')}</p>
              </div>
              <p className="mt-auto pt-6 text-xs text-white/60">{t('agents.demo.note')}</p>
            </figure>
          </div>
        </Container>
      </section>

      <section className="border-y border-line bg-wash/60 py-20 sm:py-24">
        <Container>
          <h2 className={`${SECTION_H2} max-w-3xl`}>{t('agents.can.title', { name })}</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {can.map((c) => (
              <article key={c.title} className="rounded-3xl border border-line bg-surface p-6">
                <h3 className="text-lg font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{c.text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div>
            <h2 className={SECTION_H2}>{t('agents.what.title', { name })}</h2>
            <p lang={foreignWhat} className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{what}</p>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t('agents.networks.title')}</h2>
            <ul className="mt-5 grid gap-2.5">
              {NETWORKS.map((n) => (
                <li key={n.id}>
                  <Link href={`/canaux/${n.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-wash">
                    {/* eslint-disable-next-line @next/next/no-img-element -- petit SVG statique */}
                    <img src={`/socials/${n.id}.svg`} alt="" width={28} height={28} className="h-7 w-7 rounded-[20%]" loading="lazy" />
                    <span className="flex-1 font-semibold">{networkName(n.id)}</span>
                    <StatusPill tone={n.publish === 'beta' ? 'beta' : 'soon'}>{t(capabilityKey(n.publish))}</StatusPill>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {guides.length > 0 && (
        <section className="pb-20 sm:pb-24">
          <Container>
            <h2 className="text-2xl font-bold tracking-[-0.02em]">{t('blog.related')}</h2>
            <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-2 lg:max-w-[820px]">
              {guides.map((p) => (
                <PostCard key={p.slug} post={p} locale={t.locale} />
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="border-t border-line py-20 sm:py-24">
        <Container className="max-w-3xl">
          <h2 className={SECTION_H2}>{t('agents.faq.title', { name })}</h2>
          <div className="mt-8">
            <Faq items={faq} />
          </div>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <h2 className="text-2xl font-bold tracking-[-0.02em]">{t('agents.others.title')}</h2>
          <div className="mt-6"><AgentGrid except={agent.slug} /></div>
        </Container>
      </section>

      <EndBand
        title={<RichText t={t} k="agents.end.title" tags={accentLimeTags} />}
        text={t('agents.end.text')}
        button={t('header.tryFree')}
      />
    </>
  );
}
