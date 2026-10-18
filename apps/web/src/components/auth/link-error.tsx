import { getT } from '@/i18n/server';
import { authLinkErrorKey } from '@/lib/auth-callback';

/**
 * Message en tête du formulaire quand /auth/callback renvoie ici avec `?erreur=` (Google en échec, lien périmé…).
 * Une connexion Google annulée par l'utilisateur n'est pas une erreur : ton neutre, sans alerte.
 */
export async function LinkError({ code }: { code: string | undefined }) {
  const key = authLinkErrorKey(code);
  if (!key) return null;
  const t = await getT();
  if (code === 'annule') return <p role="status" className="mb-5 rounded-xl bg-wash px-4 py-3 text-sm font-medium text-muted">{t(key)}</p>;
  return <p role="alert" className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{t(key)}</p>;
}
