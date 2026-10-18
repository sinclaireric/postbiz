import { GoogleForm } from '@/components/auth/google-form';
import { googleAuthEnabled, isDemo } from '@/lib/supabase/env';
import { getT } from '@/i18n/server';

/**
 * Bouton Google et séparateur « OU » au-dessus du formulaire e-mail, comme sur postiz.com. Affiché dès que Google est
 * activé dans Supabase (NEXT_PUBLIC_AUTH_GOOGLE=1) et en mode démo, où un clic explique que la connexion est désactivée,
 * comme le formulaire e-mail juste dessous.
 */
export async function GoogleButton({ signup = false, next }: { signup?: boolean; next?: string }) {
  if (!googleAuthEnabled && !isDemo) return null;
  const t = await getT();
  return (
    <>
      <GoogleForm signup={signup} next={next} />
      <div className="flex items-center gap-4 text-xs font-semibold tracking-widest text-subtle" role="separator">
        <span className="h-px flex-1 bg-line" />{t('auth.or')}<span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}
