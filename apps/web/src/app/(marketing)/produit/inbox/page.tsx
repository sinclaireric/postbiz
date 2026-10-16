import type { Metadata } from 'next';
import { InboxPreview } from '@/components/inbox-preview';
import { ProductPage } from '@/components/product-page';
import { RichText, accentTags } from '@/components/rich-text';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.productInbox.title'), description: t('meta.productInbox.description') };
}

export default async function InboxProductPage() {
  const t = await getT();
  return (
    <ProductPage
      eyebrow={t('productInbox.eyebrow')}
      title={<RichText t={t} k="productInbox.title" tags={accentTags} />}
      intro={t('productInbox.intro')}
      visual={<InboxPreview className="w-full max-w-[640px]" />}
      points={[
        { title: t('productInbox.p1.title'), text: t('productInbox.p1.text') },
        { title: t('productInbox.p2.title'), text: t('productInbox.p2.text') },
        { title: t('productInbox.p3.title'), text: t('productInbox.p3.text') },
        { title: t('productInbox.p4.title'), text: t('productInbox.p4.text') },
        { title: t('productInbox.p5.title'), text: t('productInbox.p5.text') },
        { title: t('productInbox.p6.title'), text: t('productInbox.p6.text') },
      ]}
      ctaTitle={t('productInbox.ctaTitle')}
    />
  );
}
