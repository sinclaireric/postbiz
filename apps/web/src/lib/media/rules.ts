import type { FormError } from '@/lib/form-error';
import type { NetworkId } from '@/lib/inbox/types';
import { networkName } from '@/lib/networks';

export type MediaKind = 'image' | 'video';

/** Ce qu'un réseau accepte comme médias dans une publication. */
export interface MediaRule {
  /** Le worker sait publier des médias sur ce réseau. Faux : on refuse la programmation plutôt que de la voir échouer à l'heure dite. */
  publishable: boolean;
  images: boolean;
  videos: boolean;
  /** Nombre maximal de médias dans une publication. */
  maxItems: number;
  /** Nombre maximal de vidéos (1 : une vidéo ne s'accompagne d'aucun autre média). */
  maxVideos: number;
  /** Images et vidéos dans la même publication (carrousel Instagram). */
  mixing: boolean;
}

/**
 * Règles par réseau, d'après les limites publiques des API. Facebook : jusqu'à 10 photos, ou une vidéo. Instagram : un média, ou un carrousel de 10 au plus
 * (images et vidéos mélangées). X : 4 images ou une vidéo. LinkedIn : 9 images ou une vidéo. TikTok et YouTube : une vidéo.
 */
export const MEDIA_RULES: Record<NetworkId, MediaRule> = {
  facebook: { publishable: true, images: true, videos: true, maxItems: 10, maxVideos: 1, mixing: false },
  instagram: { publishable: true, images: true, videos: true, maxItems: 10, maxVideos: 10, mixing: true },
  instagram_standalone: { publishable: true, images: true, videos: true, maxItems: 10, maxVideos: 10, mixing: true },
  x: { publishable: false, images: true, videos: true, maxItems: 4, maxVideos: 1, mixing: false },
  linkedin: { publishable: false, images: true, videos: true, maxItems: 9, maxVideos: 1, mixing: false },
  linkedin_page: { publishable: false, images: true, videos: true, maxItems: 9, maxVideos: 1, mixing: false },
  tiktok: { publishable: false, images: false, videos: true, maxItems: 1, maxVideos: 1, mixing: false },
  youtube: { publishable: false, images: false, videos: true, maxItems: 1, maxVideos: 1, mixing: false },
};

/** Au plus ce nombre de médias, tous réseaux confondus (la base en refuse davantage). */
export const MAX_MEDIA_PER_POST = 20;

export interface KindLike { kind: MediaKind }

/** Médias d'une publication sur un réseau : erreurs sous forme de clés de message (aucune : la publication convient). */
export function validateMedia(networkId: NetworkId, items: readonly KindLike[]): FormError[] {
  if (items.length === 0) return [];
  const rule = MEDIA_RULES[networkId];
  const network = networkName(networkId);
  const errors: FormError[] = [];
  const videos = items.filter((i) => i.kind === 'video').length;
  const images = items.length - videos;

  if (!rule.publishable) errors.push({ key: 'app.validation.mediaNotYet', params: { network } });
  if (images > 0 && !rule.images) errors.push({ key: 'app.validation.mediaNoImages', params: { network } });
  if (videos > 0 && !rule.videos) errors.push({ key: 'app.validation.mediaNoVideos', params: { network } });
  if (items.length > rule.maxItems) errors.push({ key: 'app.validation.mediaTooMany', params: { network, max: rule.maxItems } });
  else if (videos > rule.maxVideos) errors.push({ key: 'app.validation.mediaTooManyVideos', params: { network, max: rule.maxVideos } });
  else if (!rule.mixing && videos > 0 && images > 0) errors.push({ key: 'app.validation.mediaMixed', params: { network } });
  else if (rule.maxVideos === 1 && videos === 1 && items.length > 1) errors.push({ key: 'app.validation.mediaMixed', params: { network } });
  return errors;
}

/** Type d'un fichier d'après son type MIME. */
export const kindOfMime = (mime: string | null | undefined): MediaKind => (mime?.startsWith('video/') ? 'video' : 'image');
