import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/data';
import { startConnection } from '@/lib/oauth/flow';
import { createFlowDeps } from '@/lib/oauth/server';
import { siteUrl } from '@/lib/supabase/env';

// Démarrage de la connexion d'un canal : POST (bouton « Connecter »), jamais GET, pour qu'un lien externe
// ne puisse pas lancer une connexion à la place de l'utilisateur.
export async function POST(request: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  const back = (query: string) => NextResponse.redirect(`${siteUrl}/app/canaux${query}`, 303);

  // Protection CSRF : la requête doit venir de notre propre site.
  if (request.headers.get('origin') !== new URL(siteUrl).origin) return new NextResponse('Origine refusée', { status: 403 });

  const session = await getSession();
  if (session.status === 'anonymous') return NextResponse.redirect(`${siteUrl}/login`, 303);
  if (session.status !== 'ready' || session.ctx.mode === 'demo') return back('?erreur=non_configure');

  const { network } = await params;
  const deps = createFlowDeps();
  if (!deps) return back('?erreur=non_configure');

  const result = await startConnection(deps, { network, userId: session.ctx.user.id, orgId: session.ctx.org.id });
  if (!result.ok) return back(`?erreur=${result.error}&reseau=${encodeURIComponent(network)}`);
  return NextResponse.redirect(result.url, 303);
}
