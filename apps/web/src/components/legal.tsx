import type { ReactNode } from 'react';
import { RichText, boldTags } from '@/components/rich-text';
import { getT } from '@/i18n/server';
import { Container } from './ui';

export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@postbiz.com';

/** Les textes juridiques n'existent qu'en français et en anglais : les autres langues affichent l'anglais, avec un avis traduit. */
export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const t = await getT();
  const translated = t.locale === 'fr' || t.locale === 'en';
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.08] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-3 text-sm text-subtle">{t('legal.updated', { date: t('legal.datePlaceholder') })}</p>
      <div className="mt-6 rounded-2xl border border-warn/30 bg-warn-soft px-5 py-4 text-sm leading-relaxed text-warn">
        <RichText t={t} k="legal.draftNotice" tags={boldTags} />
      </div>
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
