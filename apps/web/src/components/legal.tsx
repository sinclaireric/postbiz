import Link from 'next/link';
import type { ReactNode } from 'react';
import { boldTags } from '@/components/rich-text';
import { getT } from '@/i18n/server';
import { formatArticleDate } from '@/i18n/format';
import { Container } from './ui';

export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@getpostbiz.com';

/** Qui exploite le service (raison sociale, forme, adresse, immatriculation) : à renseigner dans NEXT_PUBLIC_LEGAL_ENTITY. */
export const LEGAL_ENTITY = process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim() || 'Postbiz (getpostbiz.com)';

/** Jour de la dernière révision des textes juridiques : à changer à chaque modification de fond. */
export const LEGAL_UPDATED = '2026-10-23';

/** Les textes juridiques n'existent qu'en français et en anglais : les autres langues affichent l'anglais, avec un avis traduit. */
export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const t = await getT();
  const translated = t.locale === 'fr' || t.locale === 'en';
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.08] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-3 text-sm text-subtle">{t('legal.updated', { date: formatArticleDate(t.locale, LEGAL_UPDATED) })}</p>
      {!translated && <p className="mt-3 text-sm text-muted">{t('legal.availableIn')}</p>}
      <div
        lang={translated ? undefined : 'en'}
        dir={translated ? undefined : 'ltr'}
        className="mt-10 grid gap-10 text-[16px] leading-relaxed text-ink/90 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:ms-5 [&_li]:list-disc [&_p+p]:mt-3 [&_ul]:mt-3 [&_ul]:grid [&_ul]:gap-1.5 [&_a]:underline [&_a]:underline-offset-4"
      >
        {children}
      </div>
    </Container>
  );
}

export const mailTags = { mail: (text: string) => <a href={`mailto:${CONTACT_EMAIL}`}>{text}</a> };

const external = (href: string) => (text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;

/** Balises des textes juridiques : e-mail de contact, gras et liens vers les conditions des réseaux cités. */
export const legalTags = {
  ...mailTags,
  ...boldTags,
  yt: external('https://www.youtube.com/t/terms'),
  tt: external('https://www.tiktok.com/legal/page/row/terms-of-service/en'),
  tp: external('https://www.tiktok.com/legal/page/row/privacy-policy/en'),
  gu: external('https://developers.google.com/terms/api-services-user-data-policy'),
  gs: external('https://myaccount.google.com/permissions'),
  gp: external('https://policies.google.com/privacy'),
  del: (text: string) => <Link href="/suppression-des-donnees">{text}</Link>,
};

/** Paramètres {email} et {entity} des textes juridiques. */
export const legalVars = { email: CONTACT_EMAIL, entity: LEGAL_ENTITY };
