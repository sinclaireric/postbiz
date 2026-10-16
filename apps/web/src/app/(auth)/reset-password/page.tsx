import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/forms';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.reset.title') };
}

export default async function ResetPasswordPage() {
  const t = await getT();
  return (
    <AuthShell title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')} switchLabel="" switchHref="/login" switchText={t('auth.reset.switchText')}>
      <ResetPasswordForm />
    </AuthShell>
  );
}
