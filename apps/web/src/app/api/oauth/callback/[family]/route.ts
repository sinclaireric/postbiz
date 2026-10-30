import { NextResponse, type NextRequest } from 'next/server';
import { completeConnection } from '@/lib/oauth/flow';
import { createFlowDeps } from '@/lib/oauth/server';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { WORKSPACE_COOKIE, WORKSPACE_COOKIE_MAX_AGE } from '@/lib/workspaces';

// Retour du réseau après autorisation. Le code d'autorisation n'est jamais recopié dans une redirection.
export async function GET(request: NextRequest, { params }: { params: Promise<{ family: string }> }) {
  const go = (path: string, orgId?: string) => {
    const res = NextResponse.redirect(`${siteUrl}${path}`, 303);
    res.headers.set('Cache-Control', 'no-store');
    // La connexion a été lancée dans un espace de travail : la page de retour s'ouvre dans celui-là, même si la personne en a ouvert un autre entre-temps.
    if (orgId) res.cookies.set(WORKSPACE_COOKIE, orgId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: WORKSPACE_COOKIE_MAX_AGE, path: '/' });
    return res;
  };

  if (isDemo) return go('/app/canaux?erreur=non_configure');

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return go('/login?next=/app/canaux');

  const deps = createFlowDeps();
  if (!deps) return go('/app/canaux?erreur=non_configure');

  const { family } = await params;
  const r = await completeConnection(deps, { family, params: request.nextUrl.searchParams, userId: data.user.id });
  switch (r.kind) {
    case 'select':
      return go(`/app/canaux/connecter/${r.pendingId}`, await memberOf(supabase, data.user.id, r.orgId));
    case 'connected':
      return go(`/app/canaux?connecte=${r.count}&reseau=${r.network}${r.webhookWarnings > 0 ? '&webhooks=ko' : ''}`, await memberOf(supabase, data.user.id, r.orgId));
    case 'error':
      return go(`/app/canaux?erreur=${r.code}${r.network ? `&reseau=${r.network}` : ''}`);
  }
}

/** L'espace du `state`, seulement si la personne en est membre (lecture sous sa session, donc sous la RLS) : le cookie n'est jamais posé sur parole. */
async function memberOf(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, orgId: string): Promise<string | undefined> {
  const { data } = await supabase.from('memberships').select('org_id').eq('user_id', userId).eq('org_id', orgId).maybeSingle();
  return data ? orgId : undefined;
}
