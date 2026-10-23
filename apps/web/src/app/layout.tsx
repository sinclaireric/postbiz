import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, Plus_Jakarta_Sans } from 'next/font/google';
import { LOCALE_META } from '@/i18n/config';
import { I18nProvider } from '@/i18n/client';
import { getClientMessages, getLocale, getT } from '@/i18n/server';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin', 'latin-ext', 'vietnamese'], variable: '--font-jakarta', display: 'swap' });
const instrument = Instrument_Serif({ subsets: ['latin', 'latin-ext'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t('meta.siteTitle'), template: t('meta.titleTemplate', { page: '%s' }) },
    description: t('meta.siteDescription'),
    // Le titre et la description de chaque page viennent de la page elle-même ; ici seulement ce qui est commun.
    openGraph: { type: 'website', siteName: 'Postbiz', locale: t.locale },
    twitter: { card: 'summary_large_image' },
    applicationName: 'Postbiz',
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = { themeColor: '#fafaf7', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const meta = LOCALE_META[locale];
  const messages = await getClientMessages(locale);

  return (
    <html lang={meta.tag} dir={meta.dir} className={`${jakarta.variable} ${instrument.variable}`}>
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <I18nProvider locale={locale} messages={messages}>{children}</I18nProvider>
      </body>
    </html>
  );
}
