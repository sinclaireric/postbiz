import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoBanner } from '@/components/auth/demo-banner';
import { LoginForm } from '@/components/auth/forms';
import { GoogleButton } from '@/components/auth/google-button';
import { safeNext } from '@/lib/safe-redirect';

export const metadata: Metadata = { title: 'Connexion' };

const ERRORS: Record<string, string> = {
  lien: 'Ce lien n’est plus valide. Demandez-en un nouveau.',
  google: 'La connexion avec Google a échoué. Réessayez.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erreur?: string }> }) {
  const { next, erreur } = await searchParams;
  return (
    <AuthShell title="Bon retour" subtitle="Connectez-vous pour retrouver vos messages et vos publications." switchLabel="Pas encore de compte ?" switchHref="/signup" switchText="Créer un compte">
      <DemoBanner />
      {erreur && ERRORS[erreur] && <p role="alert" className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{ERRORS[erreur]}</p>}
      <div className="grid gap-5">
        <GoogleButton label="Continuer avec Google" />
        <LoginForm next={safeNext(next)} />
      </div>
    </AuthShell>
  );
}
