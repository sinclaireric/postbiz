import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoBanner } from '@/components/auth/demo-banner';
import { ForgotPasswordForm } from '@/components/auth/forms';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.forgot.title') };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <AuthShell title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')} switchLabel={t('auth.forgot.switchLabel')} switchHref="/login" switchText={t('auth.forgot.switchText')}>
      <DemoBanner />
      <ForgotPasswordForm />
    </AuthShell>
  );
}
