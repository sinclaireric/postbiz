import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const instrument = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Postbiz — Planifiez vos posts, répondez à tous vos messages', template: '%s · Postbiz' },
  description:
    'Postbiz réunit la planification de vos publications et une boîte de réception unifiée pour les messages privés et commentaires de Facebook, Instagram, X, LinkedIn, TikTok et YouTube.',
  openGraph: { type: 'website', siteName: 'Postbiz', locale: 'fr_FR' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: '#fafaf7', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${jakarta.variable} ${instrument.variable}`}>
      <body className="min-h-dvh bg-paper text-ink antialiased">{children}</body>
    </html>
  );
}
