import type { Metadata } from 'next';
import { LegalPage, legalTags, legalVars } from '@/components/legal';
import { RichText } from '@/components/rich-text';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.bot.title') };
}

const tags = { ...legalTags, code: (text: string) => <code className="rounded bg-wash px-1.5 py-0.5 text-[0.9em]">{text}</code> };

// Cette page est l'adresse que PostbizBot donne dans son User-Agent : un propriétaire de site qui le voit dans ses journaux y trouve qui il est et comment le bloquer.
export default async function BotPage() {
  const t = await getT();
  const vars = legalVars;
  return (
    <LegalPage title={t('legal.bot.title')}>
      <section>
        <h2>{t('legal.bot.s1.h')}</h2>
        <p><RichText t={t} k="legal.bot.s1.p" params={vars} tags={tags} /></p>
      </section>
      <section>
        <h2>{t('legal.bot.s2.h')}</h2>
        <ul>
          <li><RichText t={t} k="legal.bot.s2.li1" params={vars} tags={tags} /></li>
          <li><RichText t={t} k="legal.bot.s2.li2" params={vars} tags={tags} /></li>
          <li><RichText t={t} k="legal.bot.s2.li3" params={vars} tags={tags} /></li>
          <li><RichText t={t} k="legal.bot.s2.li4" params={vars} tags={tags} /></li>
          <li><RichText t={t} k="legal.bot.s2.li5" params={vars} tags={tags} /></li>
        </ul>
      </section>
      <section>
        <h2>{t('legal.bot.s3.h')}</h2>
        <p><RichText t={t} k="legal.bot.s3.p1" params={vars} tags={tags} /></p>
        <pre dir="ltr" className="mt-3 overflow-x-auto rounded-xl bg-wash p-4 text-sm leading-relaxed"><code>{'User-agent: PostbizBot\nDisallow: /'}</code></pre>
        <p><RichText t={t} k="legal.bot.s3.p2" params={vars} tags={tags} /></p>
      </section>
    </LegalPage>
  );
}
