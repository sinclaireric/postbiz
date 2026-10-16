import { NextResponse, type NextRequest } from 'next/server';
import { isDemo } from '@/lib/supabase/env';
import { updateSession } from '@/lib/supabase/session';

const AUTH_PAGES = ['/login', '/signup', '/forgot-password'];

export async function proxy(request: NextRequest) {
  if (isDemo) return NextResponse.next(); // mode démo : pas de session à gérer

  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!user && pathname.startsWith('/app')) {
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
  // Tout sauf les fichiers statiques et les images
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
