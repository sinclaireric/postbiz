import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage } from '@/components/legal';

export const metadata: Metadata = { title: 'Suppression des données' };

// Cette page sert d'« URL d'instructions de suppression des données » exigée par Meta pour valider l'application.
export default function DataDeletionPage() {
  return (
    <LegalPage title="Suppression de vos données" updated="[date]">
      <section>
        <h2>Supprimer les données d’un canal</h2>
        <p>Dans Postbiz, ouvrez <strong>Canaux</strong>, choisissez le canal puis <strong>Déconnecter</strong>. Les jetons d’accès sont supprimés immédiatement, ainsi que les conversations et messages associés dans un délai de [30] jours.</p>
      </section>
      <section>
        <h2>Supprimer votre compte</h2>
        <p>Dans <strong>Réglages</strong>, choisissez <strong>Supprimer mon compte</strong>. Votre profil, vos organisations dont vous êtes le seul administrateur et toutes les données associées sont supprimés dans un délai de [30] jours.</p>
      </section>
      <section>
        <h2>Vous avez retiré Postbiz depuis Facebook ou Instagram</h2>
        <p>Si vous supprimez l’application Postbiz depuis les réglages de votre compte Facebook ou Instagram, nous cessons de recevoir vos données et supprimons les jetons correspondants. Pour demander l’effacement des conversations déjà enregistrées, écrivez-nous en indiquant le nom du compte concerné.</p>
      </section>
      <section>
        <h2>Par e-mail</h2>
        <p>Écrivez à <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> depuis l’adresse de votre compte. Nous confirmons la suppression par retour de message.</p>
      </section>
    </LegalPage>
  );
}
