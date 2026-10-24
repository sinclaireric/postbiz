import { INSTAGRAM_MAX_RATIO, INSTAGRAM_MIN_RATIO, instagramRatioOk } from "@/lib/image-fit";
import type { ChannelNetwork } from "@/types";

// Règles de médias par réseau, identiques à celles du web (apps/web/src/lib/media/rules.ts), avec des messages en français.
// Elles évitent de programmer une publication que le réseau refuserait à l'heure dite.

export type MediaKind = "image" | "video";

type Rule = { publishable: boolean; images: boolean; videos: boolean; maxItems: number; maxVideos: number; mixing: boolean };

const RULES: Partial<Record<ChannelNetwork, Rule>> = {
  facebook: { publishable: true, images: true, videos: true, maxItems: 10, maxVideos: 1, mixing: false },
  instagram: { publishable: true, images: true, videos: true, maxItems: 10, maxVideos: 10, mixing: true },
  x: { publishable: false, images: true, videos: true, maxItems: 4, maxVideos: 1, mixing: false },
  linkedin: { publishable: false, images: true, videos: true, maxItems: 9, maxVideos: 1, mixing: false },
  tiktok: { publishable: false, images: false, videos: true, maxItems: 1, maxVideos: 1, mixing: false },
  youtube: { publishable: false, images: false, videos: true, maxItems: 1, maxVideos: 1, mixing: false },
};

/** Ces réseaux refusent une publication sans média. */
const REQUIRES_MEDIA: ChannelNetwork[] = ["instagram", "tiktok", "youtube"];

export const MAX_MEDIA_PER_POST = 20;
/** Limite du bucket « media » (1 Gio). */
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

/** Instagram : image entre 4:5 et 1,91:1, au moins 320 px de large. */
const INSTAGRAM_IMAGE = { minRatio: INSTAGRAM_MIN_RATIO, maxRatio: INSTAGRAM_MAX_RATIO, minWidth: 320 } as const;

export interface MediaLike {
  kind: MediaKind;
  name: string;
  width: number | null;
  height: number | null;
}

/** Image dont le format est refusé par Instagram mais qu'un recadrage rend acceptable. */
export const needsInstagramCrop = (m: MediaLike) => m.kind === "image" && !!m.width && !!m.height && !instagramRatioOk(m.width, m.height);

export const requiresMedia = (network: ChannelNetwork) => REQUIRES_MEDIA.includes(network);

/** Messages d'erreur (vide : la publication convient) pour les médias d'une publication sur un réseau. */
export function validateMedia(network: ChannelNetwork, label: string, items: readonly MediaLike[]): string[] {
  if (items.length === 0) return requiresMedia(network) ? [`${label} exige une image ou une vidéo.`] : [];
  const rule = RULES[network];
  if (!rule) return [];
  const errors: string[] = [];
  const videos = items.filter((i) => i.kind === "video").length;
  const images = items.length - videos;

  if (!rule.publishable) errors.push(`${label} : l’envoi de médias n’est pas encore disponible sur ce réseau.`);
  if (images > 0 && !rule.images) errors.push(`${label} n’accepte pas les images.`);
  if (videos > 0 && !rule.videos) errors.push(`${label} n’accepte pas les vidéos.`);
  if (items.length > rule.maxItems) errors.push(`${label} : ${rule.maxItems} médias au maximum.`);
  else if (videos > rule.maxVideos) errors.push(`${label} : ${rule.maxVideos} vidéo${rule.maxVideos > 1 ? "s" : ""} au maximum.`);
  else if (!rule.mixing && videos > 0 && images > 0) errors.push(`${label} n’accepte pas d’images et de vidéos dans la même publication.`);
  else if (rule.maxVideos === 1 && videos === 1 && items.length > 1) errors.push(`${label} : une vidéo ne s’accompagne d’aucun autre média.`);

  if (network === "instagram") {
    for (const m of items) {
      if (m.kind !== "image" || !m.width || !m.height) continue; // dimensions inconnues : Instagram tranchera
      const ratio = m.width / m.height;
      if (ratio < INSTAGRAM_IMAGE.minRatio - 1e-6 || ratio > INSTAGRAM_IMAGE.maxRatio + 1e-6) errors.push(`Instagram : le format de « ${m.name} » n’est pas accepté (entre 4:5 et 1,91:1) : recadrez-la.`);
      else if (m.width < INSTAGRAM_IMAGE.minWidth) errors.push(`Instagram : « ${m.name} » est trop petite (${INSTAGRAM_IMAGE.minWidth} px de large minimum).`);
    }
  }
  return errors;
}
