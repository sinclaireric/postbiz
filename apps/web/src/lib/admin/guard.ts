import { notFound, redirect } from 'next/navigation';
import { getAdminAccess } from './data';

/**
 * Réserve une page au propriétaire de la plateforme. Un utilisateur connecté qui ne l'est pas voit une page introuvable : on ne confirme
 * pas l'existence de l'espace. À appeler dans chaque page, pas seulement dans le layout, qui n'est pas rendu de nouveau à chaque navigation.
 */
export async function requireAdmin(): Promise<{ email: string }> {
  const access = await getAdminAccess();
  if (access.status === 'anonymous') redirect('/login?next=/admin');
  if (access.status === 'forbidden') notFound();
  return { email: access.email };
}
