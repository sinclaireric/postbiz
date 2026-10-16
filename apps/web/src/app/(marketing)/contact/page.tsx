import type { Metadata } from 'next';
import { CONTACT_EMAIL } from '@/components/legal';
import { RichText, accentTags } from '@/components/rich-text';
import { ButtonLink, Container, Eyebrow } from '@/components/ui';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.contact.title'), description: t('meta.contact.description') };
}

export default async function ContactPage() {
  const t = await getT();
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <Eyebrow>{t('contact.eyebrow')}</Eyebrow>
      <h1 className="mt-3 text-[clamp(2.2rem,4.6vw,3.4rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
        <RichText t={t} k="contact.title" tags={accentTags} />
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-muted">{t('contact.intro')}</p>
      <div className="mt-10 rounded-3xl border border-line bg-surface p-8">
        <p className="text-sm font-semibold text-muted">{t('contact.byEmail')}</p>
        <a href={`mailto:${CONTACT_EMAIL}`} dir="ltr" className="mt-1 block text-2xl font-semibold tracking-tight underline decoration-lime decoration-4 underline-offset-4">{CONTACT_EMAIL}</a>
        <p className="mt-6 text-muted">{t('contact.hint')}</p>
        <ButtonLink href="/signup" className="mt-8">{t('contact.cta')}</ButtonLink>
      </div>
    </Container>
  );
}
