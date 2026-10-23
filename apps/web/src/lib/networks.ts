import type { MessageKey } from '@/i18n/types';

export type Capability = 'beta' | 'soon' | 'none';

export interface Network {
  id: 'facebook' | 'instagram' | 'instagram_standalone' | 'x' | 'linkedin' | 'linkedin_page' | 'tiktok' | 'youtube';
  /** Couleur d'identification du réseau dans l'interface (pastille). */
  color: string;
  publish: Capability;
  dm: Capability;
  comments: Capability;
}

/**
 * État réel de chaque réseau. « none » = le réseau ne permet pas (ou plus) l'accès par API tierce.
 * Publication : le worker publie sur Facebook (texte, photos, vidéo), Instagram (image, vidéo, carrousel), X et LinkedIn (texte seul : leurs médias
 * ne sont pas encore envoyés). TikTok et YouTube exigent une vidéo et leurs fournisseurs refusent la publication (apps/worker/src/providers).
 * Ce tableau alimente la page Canaux : il ne doit rien promettre qui ne soit pas dans la feuille de route.
 * Les noms de marque ne se traduisent pas (`NETWORK_NAME`) ; les explications sont dans les messages (`networks.<id>.note`).
 */
/** Les réseaux du site public : tous sauf la Page LinkedIn et Instagram Standalone, qui n'existent que dans l'application. */
export type SiteNetwork = Network & { id: Exclude<Network['id'], 'linkedin_page' | 'instagram_standalone'> };

export const NETWORKS: SiteNetwork[] = [
  { id: 'facebook', color: '#1877f2', publish: 'beta', dm: 'beta', comments: 'beta' },
  { id: 'instagram', color: '#e1306c', publish: 'beta', dm: 'beta', comments: 'beta' },
  { id: 'x', color: '#111110', publish: 'beta', dm: 'soon', comments: 'soon' },
  { id: 'linkedin', color: '#0a66c2', publish: 'beta', dm: 'none', comments: 'soon' },
  { id: 'tiktok', color: '#fe2c55', publish: 'soon', dm: 'soon', comments: 'soon' },
  { id: 'youtube', color: '#ff0000', publish: 'soon', dm: 'none', comments: 'beta' },
];

/**
 * Canal « Page LinkedIn » (organisation) : connecté et publié comme LinkedIn, mais avec ses propres permissions. Il n'a pas de page sur le
 * site public (qui reste sur `NETWORKS`) : il n'existe que dans l'application.
 */
export const LINKEDIN_PAGE: Network = { id: 'linkedin_page', color: '#0a66c2', publish: 'beta', dm: 'none', comments: 'soon' };

/**
 * Instagram connecté directement par « Instagram Login », sans Page Facebook. Point d'entrée de connexion seulement : le compte est ensuite
 * enregistré comme un canal `instagram` ordinaire (même inbox, mêmes règles de publication).
 */
export const INSTAGRAM_STANDALONE: Network = { id: 'instagram_standalone', color: '#e1306c', publish: 'beta', dm: 'beta', comments: 'beta' };

/** Tous les canaux connectables dans l'application : les réseaux du site, plus la Page LinkedIn et Instagram Standalone placés après leur réseau. */
export const APP_NETWORKS: Network[] = NETWORKS.flatMap((n): Network[] => (n.id === 'linkedin' ? [n, LINKEDIN_PAGE] : n.id === 'instagram' ? [n, INSTAGRAM_STANDALONE] : [n]));

export const NETWORK_NAME: Record<Network['id'], string> = {
  facebook: 'Facebook', instagram: 'Instagram', instagram_standalone: 'Instagram Standalone', x: 'X', linkedin: 'LinkedIn', linkedin_page: 'LinkedIn Page', tiktok: 'TikTok', youtube: 'YouTube',
};

export const networkById = (id: string) => APP_NETWORKS.find((n) => n.id === id);
/** Nom d'affichage d'un réseau (marque : identique dans toutes les langues). */
export const networkName = (id: string) => (id in NETWORK_NAME ? NETWORK_NAME[id as Network['id']] : id);

export const capabilityKey = (c: Capability): MessageKey => `common.capability.${c}`;
export const networkNoteKey = (id: Network['id']): MessageKey => `networks.${id}.note`;
