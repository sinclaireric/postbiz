import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage, mailTags } from '@/components/legal';
import { RichText } from '@/components/rich-text';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.terms.title') };
}

export default async function TermsPage() {
  const t = await getT();
  return (
    <LegalPage title={t('legal.terms.title')}>
      <section><h2>{t('legal.terms.s1.h')}</h2><p>{t('legal.terms.s1.p')}</p></section>
      <section><h2>{t('legal.terms.s2.h')}</h2><p>{t('legal.terms.s2.p')}</p></section>
      <section><h2>{t('legal.terms.s3.h')}</h2><p>{t('legal.terms.s3.p1')}</p><p>{t('legal.terms.s3.p2')}</p></section>
      <section><h2>{t('legal.terms.s4.h')}</h2><p>{t('legal.terms.s4.p')}</p></section>
      <section><h2>{t('legal.terms.s5.h')}</h2><p>{t('legal.terms.s5.p')}</p></section>
      <section><h2>{t('legal.terms.s6.h')}</h2><p>{t('legal.terms.s6.p')}</p></section>
      <section><h2>{t('legal.terms.s7.h')}</h2><p>{t('legal.terms.s7.p')}</p></section>
      <section><h2>{t('legal.terms.s8.h')}</h2><p>{t('legal.terms.s8.p')}</p></section>
      <section>
        <h2>{t('legal.terms.s9.h')}</h2>
        <p>{t('legal.terms.s9.p1')}</p>
        <p><RichText t={t} k="legal.terms.s9.p2" params={{ email: CONTACT_EMAIL }} tags={mailTags} /></p>
      </section>
    </LegalPage>
  );
}
