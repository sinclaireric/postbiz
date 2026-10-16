import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage, mailTags } from '@/components/legal';
import { RichText, boldTags } from '@/components/rich-text';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.privacy.title') };
}

export default async function PrivacyPage() {
  const t = await getT();
  const email = { email: CONTACT_EMAIL };
  return (
    <LegalPage title={t('legal.privacy.title')}>
      <section>
        <h2>{t('legal.privacy.s1.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s1.p" params={email} tags={mailTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s2.h')}</h2>
        <ul>
          <li><RichText t={t} k="legal.privacy.s2.li1" tags={boldTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li2" tags={boldTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li3" tags={boldTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li4" tags={boldTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li5" tags={boldTags} /></li>
        </ul>
      </section>
      <section>
        <h2>{t('legal.privacy.s3.h')}</h2>
        <ul><li>{t('legal.privacy.s3.li1')}</li><li>{t('legal.privacy.s3.li2')}</li><li>{t('legal.privacy.s3.li3')}</li></ul>
        <p>{t('legal.privacy.s3.p')}</p>
      </section>
      <section>
        <h2>{t('legal.privacy.s4.h')}</h2>
        <ul><li>{t('legal.privacy.s4.li1')}</li><li>{t('legal.privacy.s4.li2')}</li><li>{t('legal.privacy.s4.li3')}</li></ul>
        <p>{t('legal.privacy.s4.p')}</p>
      </section>
      <section><h2>{t('legal.privacy.s5.h')}</h2><p>{t('legal.privacy.s5.p')}</p></section>
      <section>
        <h2>{t('legal.privacy.s6.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s6.p" params={email} tags={mailTags} /></p>
      </section>
      <section><h2>{t('legal.privacy.s7.h')}</h2><p>{t('legal.privacy.s7.p')}</p></section>
    </LegalPage>
  );
}
