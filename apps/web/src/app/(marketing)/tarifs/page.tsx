import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingPlans } from '@/components/pricing-table';
import { RichText, accentTags } from '@/components/rich-text';
import { Container, Eyebrow } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.pricing.title'), description: t('meta.pricing.description') };
}

type Cell = boolean | string;
const ROWS: { key: MessageKey; hint?: boolean; values: [Cell, Cell, Cell] }[] = [
  { key: 'pricing.compare.rows.channels', values: ['3', '10', 'unlimited'] },
  { key: 'pricing.compare.rows.members', values: ['1', '5', '15'] },
  { key: 'pricing.compare.rows.planning', values: [true, true, true] },
  { key: 'pricing.compare.rows.inbox', values: [true, true, true] },
  { key: 'pricing.compare.rows.mobile', hint: true, values: [true, true, true] },
  { key: 'pricing.compare.rows.assign', values: [false, true, true] },
  { key: 'pricing.compare.rows.quick', hint: true, values: [false, true, true] },
  { key: 'pricing.compare.rows.push', hint: true, values: [false, true, true] },
  { key: 'pricing.compare.rows.search', values: [false, true, true] },
  { key: 'pricing.compare.rows.roles', values: [false, false, true] },
  { key: 'pricing.compare.rows.video', hint: true, values: [false, false, true] },
  { key: 'pricing.compare.rows.support', values: [false, false, true] },
];

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: 'pricing.faq.q1', a: 'pricing.faq.a1' },
  { q: 'pricing.faq.q2', a: 'pricing.faq.a2' },
  { q: 'pricing.faq.q3', a: 'pricing.faq.a3' },
  { q: 'pricing.faq.q4', a: 'pricing.faq.a4' },
];

export default async function PricingPage() {
  const t = await getT();
  const planNames = [t('pricing.plans.starter.name'), t('pricing.plans.pro.name'), t('pricing.plans.team.name')];

  return (
    <>
      <section className="pt-16 pb-6 sm:pt-24">
        <Container className="text-center">
          <Eyebrow>{t('header.pricing')}</Eyebrow>
          <h1 className="mx-auto mt-3 max-w-3xl text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
            <RichText t={t} k="pricing.title" tags={accentTags} />
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted">{t('pricing.subtitle')}</p>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <PricingPlans />
        </Container>
      </section>

      <section className="border-y border-line bg-wash py-20">
        <Container>
          <h2 className="text-[clamp(1.7rem,3vw,2.4rem)] font-semibold tracking-[-0.03em]">{t('pricing.compare.title')}</h2>
          <div className="mt-8 overflow-x-auto rounded-3xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-start text-[15px]">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-6 py-4 text-start font-medium text-muted"><span className="sr-only">{t('pricing.compare.feature')}</span></th>
                  {planNames.map((n) => <th key={n} scope="col" className="px-4 py-4 text-center font-semibold">{n}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.key} className="border-b border-line last:border-0">
                    <th scope="row" className="px-6 py-4 text-start font-medium">
                      {t(r.key)}
                      {r.hint && <span className="ms-2 rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-muted">{t('pricing.compare.soon')}</span>}
                    </th>
                    {r.values.map((v, i) => (
                      <td key={i} className="px-4 py-4 text-center">
                        {v === true ? (
                          <svg className="mx-auto text-forest-2" width="16" height="16" viewBox="0 0 14 14" fill="none" role="img" aria-label={t('pricing.compare.included')}><path d="m2.5 7.3 2.8 2.8 6-6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        ) : v === false ? (
                          <span className="text-subtle" aria-label={t('pricing.compare.notIncluded')}>—</span>
                        ) : (
                          <span className="font-semibold">{v === 'unlimited' ? t('pricing.compare.unlimited') : v}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container className="max-w-3xl">
          <h2 className="text-[clamp(1.7rem,3vw,2.4rem)] font-semibold tracking-[-0.03em]">{t('pricing.faq.title')}</h2>
          <div className="mt-8 divide-y divide-line rounded-3xl border border-line bg-surface">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-6 py-5">
                <summary className="flex items-center justify-between gap-4 text-[17px] font-semibold">
                  {t(f.q)}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-wash transition group-open:rotate-45" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted">{t(f.a)}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-muted">
            <RichText t={t} k="pricing.faq.more" tags={{ link: (text) => <Link href="/contact" className="font-semibold text-ink underline underline-offset-4">{text}</Link> }} />
          </p>
        </Container>
      </section>
    </>
  );
}
