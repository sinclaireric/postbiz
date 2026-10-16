import type { NetworkId } from '@/lib/inbox/types';

export interface NetworkRule {
  /** Longueur maximale du texte (approximative : les réseaux comptent différemment liens et émojis). */
  maxLength: number;
  /** Ce réseau refuse une publication sans image ni vidéo. */
  requiresMedia: boolean;
}

export const NETWORK_RULES: Record<NetworkId, NetworkRule> = {
  facebook: { maxLength: 63_206, requiresMedia: false },
  instagram: { maxLength: 2_200, requiresMedia: true },
  x: { maxLength: 280, requiresMedia: false },
  linkedin: { maxLength: 3_000, requiresMedia: false },
  tiktok: { maxLength: 2_200, requiresMedia: true },
  youtube: { maxLength: 5_000, requiresMedia: true },
};

const NAMES: Record<NetworkId, string> = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube' };

export type PostMode = 'draft' | 'schedule';

export interface PostInput {
  content: string;
  networkIds: NetworkId[];
  /** Valeur d'un champ datetime-local ou ISO. Fuseau local du navigateur converti côté client. */
  publishAt: string | null;
  mode: PostMode;
  hasMedia?: boolean;
  now?: Date;
}

/** Délai minimum entre maintenant et une publication programmée. */
export const MIN_LEAD_MS = 60_000;

export function validatePost(input: PostInput): string[] {
  const errors: string[] = [];
  const now = input.now ?? new Date();
  const text = input.content.trim();
  const networks = [...new Set(input.networkIds)];

  if (networks.length === 0) errors.push('Choisissez au moins un canal.');

  if (input.mode === 'schedule') {
    if (!text && !input.hasMedia) errors.push('Écrivez un texte ou ajoutez un média.');
    if (!input.publishAt) {
      errors.push('Choisissez une date et une heure de publication.');
    } else {
      const t = new Date(input.publishAt).getTime();
      if (Number.isNaN(t)) errors.push('La date de publication n’est pas valide.');
      else if (t < now.getTime() + MIN_LEAD_MS) errors.push('La date de publication doit être dans le futur.');
    }
    for (const id of networks) {
      if (NETWORK_RULES[id].requiresMedia && !input.hasMedia) {
        errors.push(`${NAMES[id]} exige une image ou une vidéo (l’envoi de médias arrive bientôt).`);
      }
    }
  }

  for (const id of networks) {
    const max = NETWORK_RULES[id].maxLength;
    if (text.length > max) errors.push(`${NAMES[id]} : ${text.length} / ${max} caractères.`);
  }
  return errors;
}

/** Plus petit plafond de caractères parmi les réseaux choisis (pour le compteur). */
export function tightestLimit(networkIds: NetworkId[]): number | null {
  if (networkIds.length === 0) return null;
  return Math.min(...networkIds.map((id) => NETWORK_RULES[id].maxLength));
}
