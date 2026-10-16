import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoBanner } from '@/components/auth/demo-banner';
import { SignupForm } from '@/components/auth/forms';
import { GoogleButton } from '@/components/auth/google-button';

export const metadata: Metadata = { title: 'Créer un compte' };

export default function SignupPage() {
  return (
    <AuthShell title="Créez votre compte" subtitle="Bêta gratuite, sans carte bancaire. Prêt en quelques minutes." switchLabel="Déjà inscrit ?" switchHref="/login" switchText="Se connecter">
      <DemoBanner />
      <div className="grid gap-5">
        <GoogleButton label="S’inscrire avec Google" />
        <SignupForm />
      </div>
    </AuthShell>
  );
}
