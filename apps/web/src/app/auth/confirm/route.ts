import { NextResponse, type NextRequest } from 'next/server';
import { confirmFailure, confirmRequest } from '@/lib/auth-callback';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

// Lien du modèle d'e-mail Supabase (`<site>/auth/confirm?token_hash=…&type=email`) : valide l'adresse, ouvre la session et
// envoie vers l'onboarding. Il n'a pas besoin du navigateur de l'inscription, contrairement au lien à code de /auth/callback.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const link = confirmRequest(searchParams);
  const failed = NextResponse.redirect(`${siteUrl}/login?erreur=${confirmFailure(link?.type)}`);
  if (!link || isDemo) return failed;

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash });
  if (!error) return NextResponse.redirect(`${siteUrl}${link.next}`);

  // Lien ouvert deux fois (double clic, aperçu d'un antivirus de messagerie) : le jeton ne sert qu'une fois, mais la session est déjà ouverte.
  const { data } = await supabase.auth.getUser();
  if (data.user) return NextResponse.redirect(`${siteUrl}${link.next}`);
  return failed;
}
