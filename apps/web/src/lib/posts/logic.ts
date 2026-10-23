import type { FormError } from '@/lib/form-error';
import type { NetworkId } from '@/lib/inbox/types';
import { networkName } from '@/lib/networks';
import { countLength } from '@/lib/text/length';

export interface NetworkRule {
  /** Longueur maximale du texte (approximative : les réseaux comptent différemment liens et émojis). */
  maxLength: number;
  /** Ce réseau refuse une publication sans image ni vidéo. */
  requiresMedia: boolean;
}

export const NETWORK_RULES: Record<NetworkId, NetworkRule> = {
  facebook: { maxLength: 63_206, requiresMedia: false },
  instagram: { maxLength: 2_200, requiresMedia: true },
  instagram_standalone: { maxLength: 2_200, requiresMedia: true },
  x: { maxLength: 280, requiresMedia: false },
  linkedin: { maxLength: 3_000, requiresMedia: false },
  linkedin_page: { maxLength: 3_000, requiresMedia: false },
  tiktok: { maxLength: 2_200, requiresMedia: true },
  youtube: { maxLength: 5_000, requiresMedia: true },
};

/**
 * Réseaux où le worker sait publier un premier commentaire (sous la publication, juste après), et la longueur maximale d'un commentaire
 * (approximative, comme celle des publications). Sur X c'est une réponse à sa propre publication. Instagram, TikTok et YouTube
 * n'ont pas de publication par l'application pour l'instant : pas de premier commentaire non plus.
 */
export const FIRST_COMMENT_RULES: Partial<Record<NetworkId, { maxLength: number }>> = {
  facebook: { maxLength: 8_000 },
  linkedin: { maxLength: 1_250 },
  linkedin_page: { maxLength: 1_250 },
  x: { maxLength: 280 },
};
export const supportsFirstComment = (id: NetworkId) => id in FIRST_COMMENT_RULES;

export type PostMode = 'draft' | 'schedule';

export interface PostInput {
  content: string;
  networkIds: NetworkId[];
  /** Valeur d'un champ datetime-local ou ISO. Fuseau local du navigateur converti côté client. */
  publishAt: string | null;
  mode: PostMode;
  hasMedia?: boolean;
  /** Premier commentaire, publié sous la publication sur les réseaux qui le permettent. */
  firstComment?: string;
  now?: Date;
}

/** Délai minimum entre maintenant et une publication programmée. */
export const MIN_LEAD_MS = 60_000;

/** Erreurs de validation d'une publication, sous forme de clés de message (traduites à l'affichage). */
export function validatePost(input: PostInput): FormError[] {
  const errors: FormError[] = [];
  const now = input.now ?? new Date();
  const text = input.content.trim();
  const networks = [...new Set(input.networkIds)];

  if (networks.length === 0) errors.push({ key: 'app.validation.noChannel' });

  if (input.mode === 'schedule') {
    if (!text && !input.hasMedia) errors.push({ key: 'app.validation.needTextOrMedia' });
    if (!input.publishAt) {
      errors.push({ key: 'app.validation.needDate' });
    } else {
      const t = new Date(input.publishAt).getTime();
      if (Number.isNaN(t)) errors.push({ key: 'app.validation.invalidDate' });
      else if (t < now.getTime() + MIN_LEAD_MS) errors.push({ key: 'app.validation.pastDate' });
    }
    for (const id of networks) {
      if (NETWORK_RULES[id].requiresMedia && !input.hasMedia) {
        errors.push({ key: 'app.validation.needsMedia', params: { network: networkName(id) } });
      }
    }
  }

  for (const id of networks) {
    const max = NETWORK_RULES[id].maxLength;
    const length = countLength(id, text);
    if (length > max) errors.push({ key: 'app.validation.tooLong', params: { network: networkName(id), length, max } });
  }

  const comment = (input.firstComment ?? '').trim();
  if (comment) {
    const supported = networks.filter(supportsFirstComment);
    if (supported.length === 0) errors.push({ key: 'app.validation.firstCommentUnsupported' });
    for (const id of supported) {
      const max = FIRST_COMMENT_RULES[id]!.maxLength;
      const length = countLength(id, comment);
      if (length > max) errors.push({ key: 'app.validation.firstCommentTooLong', params: { network: networkName(id), length, max } });
    }
  }
  return errors;
}

/** Plus petit plafond de caractères parmi les réseaux choisis (pour le compteur). */
export function tightestLimit(networkIds: NetworkId[]): number | null {
  if (networkIds.length === 0) return null;
  return Math.min(...networkIds.map((id) => NETWORK_RULES[id].maxLength));
}
