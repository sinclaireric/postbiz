'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { REGION_COOKIE, REGION_COOKIE_MAX_AGE, parseRegionCookie } from '@/lib/billing/geo';

/** Mémorise le pays choisi par la personne (cookie fonctionnel, sans suivi) : il l'emporte sur toute détection et fixe la monnaie des prix. */
export async function setRegionAction(code: string): Promise<void> {
  const country = parseRegionCookie(code);
  if (!country) return;
  (await cookies()).set(REGION_COOKIE, country, {
    path: '/',
    maxAge: REGION_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  revalidatePath('/tarifs');
  revalidatePath('/app/facturation');
}
