import type { Metadata } from 'next';
import { RichText, accentTags } from '@/components/rich-text';
import { Badge, ButtonLink, Container, Eyebrow } from '@/components/ui';
import { getT } from '@/i18n/server';
import { NETWORKS, capabilityKey, networkName, networkNoteKey, type Capability } from '@/lib/networks';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.channels.title'), description: t('meta.channels.description') };
}

export default async function ChannelsPage() {
  const t = await getT();
  const Cap = ({ c }: { c: Capability }) => <Badge tone={c === 'beta' ? 'lime' : 'neutral'}>{t(capabilityKey(c))}</Badge>;
  const why = [
    { title: t('channelsPage.why1.title'), text: t('channelsPage.why1.text') },
    { title: t('channelsPage.why2.title'), text: t('channelsPage.why2.text') },
    { title: t('channelsPage.why3.title'), text: t('channelsPage.why3.text') },
  ];

  return (
    <>
      <section className="pt-16 pb-12 sm:pt-24">
        <Container>
          <Eyebrow>{t('header.channels')}</Eyebrow>
          <h1 className="mt-3 max-w-3xl text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
            <RichText t={t} k="channelsPage.title" tags={accentTags} />
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{t('channelsPage.intro')}</p>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <div className="overflow-x-auto rounded-3xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-start">
              <thead>
                <tr className="border-b border-line text-sm text-muted">
                  <th scope="col" className="px-6 py-4 text-start font-medium">{t('channelsPage.network')}</th>
                  <th scope="col" className="px-4 py-4 text-start font-medium">{t('channelsPage.publish')}</th>
                  <th scope="col" className="px-4 py-4 text-start font-medium">{t('channelsPage.dm')}</th>
                  <th scope="col" className="px-4 py-4 text-start font-medium">{t('channelsPage.comments')}</th>
                  <th scope="col" className="px-6 py-4 text-start font-medium">{t('channelsPage.note')}</th>
                </tr>
              </thead>
              <tbody>
                {NETWORKS.map((n) => (
                  <tr key={n.id} className="border-b border-line align-top last:border-0">
                    <th scope="row" className="px-6 py-5 text-start">
                      <span className="flex items-center gap-3 text-[17px] font-semibold">
                        <span className="h-3 w-3 rounded-full" style={{ background: n.color }} aria-hidden="true" />
                        {networkName(n.id)}
                      </span>
                    </th>
                    <td className="px-4 py-5"><Cap c={n.publish} /></td>
                    <td className="px-4 py-5"><Cap c={n.dm} /></td>
                    <td className="px-4 py-5"><Cap c={n.comments} /></td>
                    <td className="px-6 py-5 text-[15px] leading-relaxed text-muted">{t(networkNoteKey(n.id))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-subtle">{t('channelsPage.footnote')}</p>
        </Container>
      </section>

      <section className="border-t border-line bg-wash py-20">
        <Container className="grid gap-6 md:grid-cols-3">
          {why.map((x) => (
            <article key={x.title} className="rounded-3xl border border-line bg-surface p-7">
              <h2 className="text-lg font-semibold">{x.title}</h2>
              <p className="mt-3 leading-relaxed text-muted">{x.text}</p>
            </article>
          ))}
        </Container>
      </section>

      <section className="py-20 text-center">
        <Container>
          <h2 className="text-[clamp(1.8rem,3.4vw,2.6rem)] font-semibold tracking-[-0.03em]">{t('channelsPage.ctaTitle')}</h2>
          <div className="mt-7 flex justify-center gap-3">
            <ButtonLink href="/signup" size="lg">{t('channelsPage.ctaPrimary')}</ButtonLink>
            <ButtonLink href="/contact" variant="secondary" size="lg">{t('channelsPage.ctaSuggest')}</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
