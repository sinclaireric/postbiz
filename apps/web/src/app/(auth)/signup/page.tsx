import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoBanner } from '@/components/auth/demo-banner';
import { SignupForm } from '@/components/auth/forms';
import { GoogleButton } from '@/components/auth/google-button';
import { LinkError } from '@/components/auth/link-error';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.signup.title') };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  const t = await getT();
  return (
    <AuthShell title={t('auth.signup.title')} subtitle={t('auth.signup.subtitle')} switchLabel={t('auth.signup.switchLabel')} switchHref="/login" switchText={t('auth.signup.switchText')}>
      <DemoBanner />
      <LinkError code={erreur} />
      <div className="grid gap-5">
        <GoogleButton signup />
        <SignupForm />
      </div>
    </AuthShell>
  );
}
