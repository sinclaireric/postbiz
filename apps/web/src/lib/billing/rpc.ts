/**
 * La fonction SQL appelée n'existe pas (encore) sur ce projet Supabase : la migration de facturation n'est pas appliquée. PostgREST répond `PGRST202`
 * (« Could not find the function … in the schema cache »), Postgres `42883` (undefined_function).
 * Les réservations de quota s'en servent pour ne pas tomber en panne pendant un déploiement fait avant la migration : sans la fonction, il n'y a
 * pas de quota à appliquer.
 */
export function isMissingFunction(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? '');
}
