import type { Metadata } from 'next';
import { LegalPage, legalTags, legalVars } from '@/components/legal';
import { RichText } from '@/components/rich-text';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.privacy.title') };
}

export default async function PrivacyPage() {
  const t = await getT();
  const vars = legalVars;
  return (
    <LegalPage title={t('legal.privacy.title')}>
      <section>
        <h2>{t('legal.privacy.s1.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s1.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s2.h')}</h2>
        <ul>
          <li><RichText t={t} k="legal.privacy.s2.li1" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li2" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li3" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li4" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li5" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li6" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li7" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li8" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s2.li9" params={vars} tags={legalTags} /></li>
        </ul>
      </section>
      <section>
        <h2>{t('legal.privacy.s3.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s3.p1" params={vars} tags={legalTags} /></p>
        <ul>
          <li><RichText t={t} k="legal.privacy.s3.li1" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s3.li2" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s3.li3" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s3.li4" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s3.li5" params={vars} tags={legalTags} /></li>
        </ul>
        <p><RichText t={t} k="legal.privacy.s3.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s4.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s4.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.privacy.s4.p2" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.privacy.s4.p3" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s5.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s5.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.privacy.s5.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s6.h')}</h2>
        <ul>
          <li><RichText t={t} k="legal.privacy.s6.li1" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s6.li2" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s6.li3" params={vars} tags={legalTags} /></li>
        </ul>
        <p><RichText t={t} k="legal.privacy.s6.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s7.h')}</h2>
        <ul>
          <li><RichText t={t} k="legal.privacy.s7.li1" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s7.li2" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s7.li3" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s7.li4" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s7.li5" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s7.li6" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s7.li7" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.privacy.s7.li8" params={vars} tags={legalTags} /></li>
        </ul>
        <p><RichText t={t} k="legal.privacy.s7.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s8.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s8.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.privacy.s8.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s9.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s9.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s10.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s10.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s11.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s11.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.privacy.s12.h')}</h2>
        <p><RichText t={t} k="legal.privacy.s12.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.privacy.s12.p2" params={vars} tags={legalTags} /></p>
      </section>
    </LegalPage>
  );
}
