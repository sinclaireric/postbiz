import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoBanner } from '@/components/auth/demo-banner';
import { LoginForm } from '@/components/auth/forms';
import { GoogleButton } from '@/components/auth/google-button';
import { LinkError } from '@/components/auth/link-error';
import { getT } from '@/i18n/server';
import { safeNext } from '@/lib/safe-redirect';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.login.title') };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erreur?: string }> }) {
  const { next, erreur } = await searchParams;
  const t = await getT();
  const destination = safeNext(next);
  return (
    <AuthShell title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} switchLabel={t('auth.login.switchLabel')} switchHref="/signup" switchText={t('auth.login.switchText')}>
      <DemoBanner />
      <LinkError code={erreur} />
      <div className="grid gap-5">
        <GoogleButton next={destination} />
        <LoginForm next={destination} />
      </div>
    </AuthShell>
  );
}
