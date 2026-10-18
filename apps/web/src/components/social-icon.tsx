import { networkName, type Network } from '@/lib/networks';

/** Logos disponibles (public/socials/) : les six réseaux, Messenger (messages privés Facebook) et WhatsApp. */
export type SocialId = Network['id'] | 'messenger' | 'whatsapp';

/** Nom de marque d'un logo (jamais traduit). */
export const socialName = (id: SocialId) => (id === 'messenger' ? 'Messenger' : id === 'whatsapp' ? 'WhatsApp' : networkName(id));

/** Logo d'un réseau en pastille carrée aux angles arrondis. Décoratif : le nom du réseau est toujours écrit à côté. */
export function SocialIcon({ id, size, className = '' }: { id: SocialId; size: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- petit SVG statique
    <img src={`/socials/${id}.svg`} alt="" width={size} height={size} draggable={false} className={`shrink-0 select-none rounded-[28%] ${className}`} style={{ width: size, height: size }} />
  );
}
