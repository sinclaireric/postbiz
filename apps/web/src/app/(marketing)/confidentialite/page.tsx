import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage } from '@/components/legal';

export const metadata: Metadata = { title: 'Politique de confidentialité' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" updated="[date]">
      <section>
        <h2>1. Responsable du traitement</h2>
        <p>[RAISON SOCIALE], [adresse]. Contact : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </section>
      <section>
        <h2>2. Données que nous traitons</h2>
        <ul>
          <li><strong>Compte :</strong> adresse e-mail, nom affiché, mot de passe (stocké sous forme chiffrée par notre prestataire d’authentification).</li>
          <li><strong>Canaux connectés :</strong> identifiant, nom et photo du compte, et jetons d’accès fournis par le réseau (chiffrés avant enregistrement).</li>
          <li><strong>Messages et commentaires :</strong> contenus reçus et envoyés sur les comptes que vous connectez, ainsi que l’identifiant public, le nom et le pseudonyme des personnes qui vous écrivent.</li>
          <li><strong>Publications :</strong> textes, médias et dates que vous programmez.</li>
          <li><strong>Usage :</strong> journaux techniques nécessaires à la sécurité et au bon fonctionnement du service.</li>
        </ul>
      </section>
      <section>
        <h2>3. Finalités et bases légales</h2>
        <ul>
          <li>Fournir le service (exécution du contrat).</li>
          <li>Assurer la sécurité et prévenir les abus (intérêt légitime).</li>
          <li>Répondre à vos demandes de support (intérêt légitime).</li>
        </ul>
        <p>Nous n’utilisons pas vos messages ni vos publications pour entraîner des modèles d’intelligence artificielle et nous ne les vendons pas.</p>
      </section>
      <section>
        <h2>4. Sous-traitants</h2>
        <ul>
          <li>Supabase Inc. — base de données, authentification et stockage [région d’hébergement : à compléter].</li>
          <li>[Hébergeur de l’application et du worker : à compléter].</li>
          <li>[Prestataire d’envoi d’e-mails : à compléter].</li>
        </ul>
        <p>Les réseaux sociaux que vous connectez sont des responsables de traitement distincts, régis par leurs propres politiques.</p>
      </section>
      <section>
        <h2>5. Durées de conservation</h2>
        <p>Les données du compte sont conservées tant que le compte existe. Les messages et commentaires sont supprimés lorsque vous déconnectez le canal concerné ou supprimez votre compte, dans un délai de [30] jours. [À ajuster.]</p>
      </section>
      <section>
        <h2>6. Vos droits</h2>
        <p>Vous pouvez demander l’accès, la rectification, l’effacement, la limitation, la portabilité de vos données et vous opposer à leur traitement en écrivant à <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Vous pouvez aussi saisir la CNIL.</p>
      </section>
      <section>
        <h2>7. Sécurité</h2>
        <p>Isolation des données par organisation au niveau de la base de données, chiffrement des jetons d’accès, chiffrement des échanges. Aucun système n’étant infaillible, nous vous informons en cas d’incident affectant vos données.</p>
      </section>
    </LegalPage>
  );
}
