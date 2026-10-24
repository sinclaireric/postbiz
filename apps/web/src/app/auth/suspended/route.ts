import { NextResponse } from 'next/server';
import { isAccountSuspended } from '@/lib/data';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

/**
 * Arrivée d'un compte suspendu dont le jeton est encore valide : on ferme sa session et on l'envoie vers la connexion, avec le motif.
 * Un compte qui n'est pas suspendu n'est jamais déconnecté par cette adresse.
 */
export async function GET() {
  if (isDemo || !(await isAccountSuspended())) return NextResponse.redirect(`${siteUrl}/app`);
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${siteUrl}/login?erreur=suspendu`);
}
