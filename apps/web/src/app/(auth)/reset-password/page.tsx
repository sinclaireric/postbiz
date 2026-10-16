import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/forms';

export const metadata: Metadata = { title: 'Nouveau mot de passe' };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Nouveau mot de passe" subtitle="Choisissez un mot de passe d’au moins 8 caractères." switchLabel="" switchHref="/login" switchText="Retour à la connexion">
      <ResetPasswordForm />
    </AuthShell>
  );
}
