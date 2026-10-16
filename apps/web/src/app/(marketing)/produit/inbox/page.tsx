import type { Metadata } from 'next';
import { InboxPreview } from '@/components/inbox-preview';
import { ProductPage } from '@/components/product-page';

export const metadata: Metadata = {
  title: 'Boîte de réception unifiée',
  description: 'Messages privés Messenger et Instagram, commentaires Facebook, Instagram et YouTube : une seule boîte de réception pour toute votre équipe.',
};

export default function InboxProductPage() {
  return (
    <ProductPage
      eyebrow="Boîte de réception"
      title={<>Tous vos messages et commentaires, <span className="accent">dans une seule liste</span></>}
      intro="Fini de passer d’une application à l’autre. Messenger, Instagram et les commentaires de vos publications arrivent en direct dans Postbiz, avec le contexte pour répondre vite et bien."
      visual={<InboxPreview className="w-full max-w-[640px]" />}
      points={[
        { title: 'En direct', text: 'Les nouveaux messages apparaissent sans recharger la page, sur le web comme sur mobile.' },
        { title: 'La fenêtre de 24 h visible', text: 'Chaque conversation Messenger ou Instagram affiche le temps restant pour répondre, et les plus urgentes passent en premier.' },
        { title: 'Pensé pour l’équipe', text: 'Assignez une conversation, laissez une note interne, utilisez des réponses rapides, changez le statut : ouvert, en attente, fermé.' },
        { title: 'Recherche dans tout l’historique', text: 'Retrouvez une conversation par un mot, un nom ou un pseudonyme.' },
        { title: 'Messages et commentaires ensemble', text: 'Répondez à un commentaire public, puis poursuivez en message privé, sans perdre le fil.' },
        { title: 'Transparent sur les limites', text: 'LinkedIn et YouTube n’ouvrent pas leurs messages privés : nous l’indiquons, au lieu de le cacher.' },
      ]}
      ctaTitle="Répondez à chaque message, au bon moment"
    />
  );
}
