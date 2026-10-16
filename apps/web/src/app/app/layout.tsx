import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Application', template: '%s · Postbiz' }, robots: { index: false, follow: false } };

export default function AppRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
