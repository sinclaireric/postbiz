import type { Metadata } from 'next';
import { ProductPage } from '@/components/product-page';
import { RichText, accentTags } from '@/components/rich-text';
import { getT } from '@/i18n/server';
import type { T } from '@/i18n/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.productPlanning.title'), description: t('meta.productPlanning.description') };
}

function CalendarVisual({ t }: { t: T }) {
  const days = [
    { label: t('calendarPreview.days.mon'), items: [{ t: '09:00 · Instagram', c: '#e1306c' }] },
    { label: t('calendarPreview.days.tue'), items: [{ t: '12:30 · LinkedIn', c: '#0a66c2' }, { t: '18:00 · X', c: '#111110' }] },
    { label: t('calendarPreview.days.wed'), items: [] },
    { label: t('calendarPreview.days.thu'), items: [{ t: '10:00 · Facebook', c: '#1877f2' }] },
    { label: t('calendarPreview.days.fri'), items: [{ t: '17:00 · YouTube', c: '#ff0000' }, { t: '19:00 · TikTok', c: '#fe2c55' }] },
  ];
  return (
    <div className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)]" role="img" aria-label={t('calendarPreview.label')}>
      <div className="border-b border-line bg-wash px-4 py-2.5 text-xs font-medium text-subtle">{t('calendarPreview.title')}</div>
      <div className="grid grid-cols-5 gap-px bg-line text-[12px]">
        {days.map((d) => (
          <div key={d.label} className="min-h-[230px] bg-surface p-2.5">
            <p className="font-semibold text-muted">{d.label}</p>
            <div className="mt-2 grid gap-1.5">
              {d.items.map((i) => (
                <p key={i.t} dir="ltr" className="rounded-lg border border-line bg-paper px-2 py-1.5 leading-tight font-medium">
                  <span className="me-1.5 inline-block h-2 w-2 rounded-full" style={{ background: i.c }} />
                  {i.t}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function PlanningProductPage() {
  const t = await getT();
  return (
    <ProductPage
      eyebrow={t('productPlanning.eyebrow')}
      title={<RichText t={t} k="productPlanning.title" tags={accentTags} />}
      intro={t('productPlanning.intro')}
      visual={<CalendarVisual t={t} />}
      points={[
        { title: t('productPlanning.p1.title'), text: t('productPlanning.p1.text') },
        { title: t('productPlanning.p2.title'), text: t('productPlanning.p2.text') },
        { title: t('productPlanning.p3.title'), text: t('productPlanning.p3.text') },
        { title: t('productPlanning.p4.title'), text: t('productPlanning.p4.text') },
        { title: t('productPlanning.p5.title'), text: t('productPlanning.p5.text') },
        { title: t('productPlanning.p6.title'), text: t('productPlanning.p6.text') },
      ]}
      ctaTitle={t('productPlanning.ctaTitle')}
    />
  );
}
