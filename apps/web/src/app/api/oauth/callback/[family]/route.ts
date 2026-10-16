import { NextResponse, type NextRequest } from 'next/server';
import { completeConnection } from '@/lib/oauth/flow';
import { createFlowDeps } from '@/lib/oauth/server';
import { isDemo, siteUrl } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

// Retour du réseau après autorisation. Le code d'autorisation n'est jamais recopié dans une redirection.
export async function GET(request: NextRequest, { params }: { params: Promise<{ family: string }> }) {
  const go = (path: string) => {
    const res = NextResponse.redirect(`${siteUrl}${path}`, 303);
    res.headers.set('Cache-Control', 'no-store');
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
      return go(`/app/canaux/connecter/${r.pendingId}`);
    case 'connected':
      return go(`/app/canaux?connecte=${r.count}&reseau=${r.network}${r.webhookWarnings > 0 ? '&webhooks=ko' : ''}`);
    case 'error':
      return go(`/app/canaux?erreur=${r.code}${r.network ? `&reseau=${r.network}` : ''}`);
  }
}
