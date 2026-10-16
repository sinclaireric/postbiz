export type Capability = 'beta' | 'soon' | 'none';

export interface Network {
  id: 'facebook' | 'instagram' | 'x' | 'linkedin' | 'tiktok' | 'youtube';
  name: string;
  /** Couleur d'identification du réseau dans l'interface (pastille). */
  color: string;
  publish: Capability;
  dm: Capability;
  comments: Capability;
  note?: string;
}

/**
 * État réel de chaque réseau. « none » = le réseau ne permet pas (ou plus) l'accès par API tierce.
 * Ce tableau alimente la page Canaux : il ne doit rien promettre qui ne soit pas dans la feuille de route.
 */
export const NETWORKS: Network[] = [
  { id: 'facebook', name: 'Facebook', color: '#1877f2', publish: 'beta', dm: 'beta', comments: 'beta', note: 'Pages. Messages : réponse possible 24 h après le dernier message du client.' },
  { id: 'instagram', name: 'Instagram', color: '#e1306c', publish: 'beta', dm: 'beta', comments: 'beta', note: 'Comptes professionnels. Messages : réponse possible 24 h après le dernier message du client.' },
  { id: 'x', name: 'X', color: '#111110', publish: 'beta', dm: 'soon', comments: 'soon', note: 'Les messages dépendent de l’offre payante de l’API X.' },
  { id: 'linkedin', name: 'LinkedIn', color: '#0a66c2', publish: 'beta', dm: 'none', comments: 'soon', note: 'LinkedIn n’ouvre pas sa messagerie aux applications tierces. Commentaires de Pages prévus.' },
  { id: 'tiktok', name: 'TikTok', color: '#fe2c55', publish: 'beta', dm: 'soon', comments: 'soon', note: 'Messagerie soumise à l’approbation de TikTok et indisponible dans certaines régions.' },
  { id: 'youtube', name: 'YouTube', color: '#ff0000', publish: 'beta', dm: 'none', comments: 'beta', note: 'YouTube n’a pas de messages privés : commentaires uniquement.' },
];

export const networkById = (id: string) => NETWORKS.find((n) => n.id === id);

export const CAPABILITY_LABEL: Record<Capability, string> = { beta: 'Bêta', soon: 'Bientôt', none: 'Non disponible' };
