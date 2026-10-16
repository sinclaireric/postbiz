import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoBanner } from '@/components/auth/demo-banner';
import { LoginForm } from '@/components/auth/forms';
import { GoogleButton } from '@/components/auth/google-button';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/types';
import { safeNext } from '@/lib/safe-redirect';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.login.title') };
}

const ERRORS: Record<string, MessageKey> = {
  lien: 'auth.linkErrors.lien',
  google: 'auth.linkErrors.google',
  organisation: 'auth.linkErrors.organisation',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erreur?: string }> }) {
  const { next, erreur } = await searchParams;
  const t = await getT();
  const errorKey = erreur ? ERRORS[erreur] : undefined;
  return (
    <AuthShell title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} switchLabel={t('auth.login.switchLabel')} switchHref="/signup" switchText={t('auth.login.switchText')}>
      <DemoBanner />
      {errorKey && <p role="alert" className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{t(errorKey)}</p>}
      <div className="grid gap-5">
        <GoogleButton />
        <LoginForm next={safeNext(next)} />
      </div>
    </AuthShell>
  );
}
