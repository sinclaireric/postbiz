import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoBanner } from '@/components/auth/demo-banner';
import { ForgotPasswordForm } from '@/components/auth/forms';

export const metadata: Metadata = { title: 'Mot de passe oublié' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Mot de passe oublié" subtitle="Saisissez votre e-mail : nous vous envoyons un lien pour en choisir un nouveau." switchLabel="Vous vous en souvenez ?" switchHref="/login" switchText="Se connecter">
      <DemoBanner />
      <ForgotPasswordForm />
    </AuthShell>
  );
}
