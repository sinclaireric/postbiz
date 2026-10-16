import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage } from '@/components/legal';

export const metadata: Metadata = { title: 'Conditions d’utilisation' };

export default function TermsPage() {
  return (
    <LegalPage title="Conditions générales d’utilisation" updated="[date]">
      <section>
        <h2>1. Éditeur et objet</h2>
        <p>Postbiz est édité par [RAISON SOCIALE], [forme juridique], [adresse], immatriculée sous le numéro [SIREN/RCS]. Les présentes conditions encadrent l’utilisation du service Postbiz, qui permet de planifier des publications et de gérer les messages et commentaires de comptes de réseaux sociaux connectés par l’utilisateur.</p>
      </section>
      <section>
        <h2>2. Compte</h2>
        <p>L’utilisateur crée un compte avec une adresse e-mail valide et en protège les identifiants. Il est responsable des actions effectuées depuis son compte et de celles des membres qu’il invite dans son organisation.</p>
      </section>
      <section>
        <h2>3. Réseaux sociaux tiers</h2>
        <p>Postbiz agit sur les comptes que l’utilisateur autorise, via les interfaces officielles de Facebook, Instagram, X, LinkedIn, TikTok et YouTube. L’utilisateur reste soumis aux conditions de chacun de ces réseaux (par exemple, la fenêtre de 24 heures pour répondre aux messages sur Messenger et Instagram) et garantit disposer des droits nécessaires sur les contenus qu’il publie.</p>
        <p>Les fonctionnalités disponibles dépendent des autorisations accordées par chaque réseau, qui peuvent changer ou être retirées. Postbiz ne garantit pas la disponibilité d’une fonctionnalité sur un réseau donné.</p>
      </section>
      <section>
        <h2>4. Contenus et conduite</h2>
        <p>L’utilisateur s’interdit tout usage illicite du service, notamment l’envoi de messages non sollicités en masse, la diffusion de contenus illégaux ou contraires aux règles des réseaux, et toute tentative de contourner les limites techniques ou de sécurité.</p>
      </section>
      <section>
        <h2>5. Tarifs et paiement</h2>
        <p>Pendant la période de bêta, le service est fourni gratuitement. Les tarifs publiés sur la page Tarifs s’appliqueront à l’issue de la bêta, après information préalable de l’utilisateur d’au moins [30] jours. [Conditions de facturation, de résiliation et de remboursement à compléter lors de l’activation des paiements.]</p>
      </section>
      <section>
        <h2>6. Disponibilité et responsabilité</h2>
        <p>Postbiz met en œuvre des moyens raisonnables pour assurer la continuité du service, sans garantie d’absence d’interruption. [Limitation de responsabilité à compléter.]</p>
      </section>
      <section>
        <h2>7. Résiliation</h2>
        <p>L’utilisateur peut supprimer son compte à tout moment. Postbiz peut suspendre un compte en cas de manquement aux présentes conditions ou aux règles d’un réseau tiers.</p>
      </section>
      <section>
        <h2>8. Logiciel libre</h2>
        <p>Le code source de Postbiz est publié sous licence GNU AGPL-3.0. Cette licence régit le code ; les présentes conditions régissent le service hébergé par l’éditeur.</p>
      </section>
      <section>
        <h2>9. Droit applicable</h2>
        <p>Droit français. [Juridiction compétente à compléter.]</p>
        <p>Contact : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
      </section>
    </LegalPage>
  );
}
