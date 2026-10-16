import type { MessageKey } from '@/i18n/types';

export type Capability = 'beta' | 'soon' | 'none';

export interface Network {
  id: 'facebook' | 'instagram' | 'x' | 'linkedin' | 'tiktok' | 'youtube';
  /** Couleur d'identification du réseau dans l'interface (pastille). */
  color: string;
  publish: Capability;
  dm: Capability;
  comments: Capability;
}

/**
 * État réel de chaque réseau. « none » = le réseau ne permet pas (ou plus) l'accès par API tierce.
 * Ce tableau alimente la page Canaux : il ne doit rien promettre qui ne soit pas dans la feuille de route.
 * Les noms de marque ne se traduisent pas (`NETWORK_NAME`) ; les explications sont dans les messages (`networks.<id>.note`).
 */
export const NETWORKS: Network[] = [
  { id: 'facebook', color: '#1877f2', publish: 'beta', dm: 'beta', comments: 'beta' },
  { id: 'instagram', color: '#e1306c', publish: 'beta', dm: 'beta', comments: 'beta' },
  { id: 'x', color: '#111110', publish: 'beta', dm: 'soon', comments: 'soon' },
  { id: 'linkedin', color: '#0a66c2', publish: 'beta', dm: 'none', comments: 'soon' },
  { id: 'tiktok', color: '#fe2c55', publish: 'beta', dm: 'soon', comments: 'soon' },
  { id: 'youtube', color: '#ff0000', publish: 'beta', dm: 'none', comments: 'beta' },
];

export const NETWORK_NAME: Record<Network['id'], string> = {
  facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube',
};

export const networkById = (id: string) => NETWORKS.find((n) => n.id === id);
/** Nom d'affichage d'un réseau (marque : identique dans toutes les langues). */
export const networkName = (id: string) => (id in NETWORK_NAME ? NETWORK_NAME[id as Network['id']] : id);

export const capabilityKey = (c: Capability): MessageKey => `common.capability.${c}`;
export const networkNoteKey = (id: Network['id']): MessageKey => `networks.${id}.note`;
