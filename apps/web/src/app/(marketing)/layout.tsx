import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { getT } from '@/i18n/server';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        {t('common.skipToContent')}
      </a>
      <SiteHeader />
      <main id="contenu">{children}</main>
      <SiteFooter />
    </>
  );
}
