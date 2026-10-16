import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage, mailTags } from '@/components/legal';
import { RichText, boldTags } from '@/components/rich-text';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.dataDeletion.title') };
}

// Cette page sert d'« URL d'instructions de suppression des données » exigée par Meta pour valider l'application.
export default async function DataDeletionPage() {
  const t = await getT();
  return (
    <LegalPage title={t('legal.dataDeletion.title')}>
      <section><h2>{t('legal.dataDeletion.s1.h')}</h2><p><RichText t={t} k="legal.dataDeletion.s1.p" tags={boldTags} /></p></section>
      <section><h2>{t('legal.dataDeletion.s2.h')}</h2><p><RichText t={t} k="legal.dataDeletion.s2.p" tags={boldTags} /></p></section>
      <section><h2>{t('legal.dataDeletion.s3.h')}</h2><p>{t('legal.dataDeletion.s3.p')}</p></section>
      <section>
        <h2>{t('legal.dataDeletion.s4.h')}</h2>
        <p><RichText t={t} k="legal.dataDeletion.s4.p" params={{ email: CONTACT_EMAIL }} tags={mailTags} /></p>
      </section>
    </LegalPage>
  );
}
