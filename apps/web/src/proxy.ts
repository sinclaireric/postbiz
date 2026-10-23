import { NextResponse, type NextRequest } from 'next/server';
import { isDemo } from '@/lib/supabase/env';
import { updateSession } from '@/lib/supabase/session';

const AUTH_PAGES = ['/login', '/signup', '/forgot-password'];

export async function proxy(request: NextRequest) {
  if (isDemo) return NextResponse.next(); // mode démo : pas de session à gérer

  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // « /app » et ce qui est dessous seulement : pas « /apple-icon » ni une autre page dont le nom commence par « app ».
  if (!user && (pathname === '/app' || pathname.startsWith('/app/'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (user && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Tout sauf les fichiers statiques, les images et les vidéos (inutile de vérifier la session à chaque requête de lecture)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webm|mp4)$).*)'],
};
