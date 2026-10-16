import { redirect } from 'next/navigation';

// Les publications vivent maintenant dans le calendrier (comme dans Postiz) ; l'ancienne adresse redirige.
export default function PublicationsRedirect() {
  redirect('/app/calendrier');
}
