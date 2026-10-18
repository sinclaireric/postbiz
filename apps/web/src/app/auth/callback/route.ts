import { NextResponse, type NextRequest } from 'next/server';
import { callbackProblem, failureLocation, isProviderReturn, type AuthLinkError } from '@/lib/auth-callback';
import { safeNext } from '@/lib/safe-redirect';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

// Retour de Google (via Supabase) et des liens e-mail (confirmation, réinitialisation) : échange le code contre une session.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const next = safeNext(searchParams.get('next'));
  const back = (code: AuthLinkError) => NextResponse.redirect(`${siteUrl}${failureLocation(searchParams, code)}`);
  const failed: AuthLinkError = isProviderReturn(searchParams) ? 'google' : 'lien';

  // L'utilisateur a refusé sur l'écran Google, ou le lien a expiré : rien à échanger.
  const problem = callbackProblem(searchParams);
  if (problem) return back(problem);

  const code = searchParams.get('code');
  if (!code || isDemo) return back(failed);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) return NextResponse.redirect(`${siteUrl}${next}`);

  // Page rechargée ou lien ouvert deux fois : le code ne sert qu'une fois, mais la session est déjà ouverte.
  const { data } = await supabase.auth.getUser();
  if (data.user) return NextResponse.redirect(`${siteUrl}${next}`);
  return back(failed);
}
