import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/safe-redirect';
import { siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

// Retour des liens e-mail (confirmation, réinitialisation) et de Google : échange le code contre une session.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${siteUrl}${next}`);
  }
  return NextResponse.redirect(`${siteUrl}/login?erreur=lien`);
}
