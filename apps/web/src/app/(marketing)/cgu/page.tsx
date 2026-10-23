import type { Metadata } from 'next';
import { LegalPage, legalTags, legalVars } from '@/components/legal';
import { RichText } from '@/components/rich-text';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.terms.title') };
}

export default async function TermsPage() {
  const t = await getT();
  const vars = legalVars;
  return (
    <LegalPage title={t('legal.terms.title')}>
      <section>
        <h2>{t('legal.terms.s1.h')}</h2>
        <p><RichText t={t} k="legal.terms.s1.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.terms.s1.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s2.h')}</h2>
        <p><RichText t={t} k="legal.terms.s2.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s3.h')}</h2>
        <p><RichText t={t} k="legal.terms.s3.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.terms.s3.p2" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.terms.s3.p3" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s4.h')}</h2>
        <p><RichText t={t} k="legal.terms.s4.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.terms.s4.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s5.h')}</h2>
        <p><RichText t={t} k="legal.terms.s5.p1" params={vars} tags={legalTags} /></p>
        <ul>
          <li><RichText t={t} k="legal.terms.s5.li1" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.terms.s5.li2" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.terms.s5.li3" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.terms.s5.li4" params={vars} tags={legalTags} /></li>
          <li><RichText t={t} k="legal.terms.s5.li5" params={vars} tags={legalTags} /></li>
        </ul>
        <p><RichText t={t} k="legal.terms.s5.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s6.h')}</h2>
        <p><RichText t={t} k="legal.terms.s6.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.terms.s6.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s7.h')}</h2>
        <p><RichText t={t} k="legal.terms.s7.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s8.h')}</h2>
        <p><RichText t={t} k="legal.terms.s8.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.terms.s8.p2" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s9.h')}</h2>
        <p><RichText t={t} k="legal.terms.s9.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s10.h')}</h2>
        <p><RichText t={t} k="legal.terms.s10.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s11.h')}</h2>
        <p><RichText t={t} k="legal.terms.s11.p1" params={vars} tags={legalTags} /></p>
      </section>
      <section>
        <h2>{t('legal.terms.s12.h')}</h2>
        <p><RichText t={t} k="legal.terms.s12.p1" params={vars} tags={legalTags} /></p>
        <p><RichText t={t} k="legal.terms.s12.p2" params={vars} tags={legalTags} /></p>
      </section>
    </LegalPage>
  );
}
