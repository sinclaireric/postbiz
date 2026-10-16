import type { MessageKey } from '@/i18n/types';
import { NETWORKS, type Capability } from '@/lib/networks';
import type { OrgRole } from '@/lib/data/types';

/**
 * - `connect` : le bouton lance la connexion OAuth ;
 * - `demo` : mode démo, la connexion est simulée pour pouvoir parcourir l'onboarding ;
 * - `admin_only` : seul un administrateur de l'organisation peut connecter un canal ;
 * - `unavailable` : les clés API du réseau ne sont pas configurées sur ce serveur.
 */
export type TileState = 'connect' | 'demo' | 'admin_only' | 'unavailable';

export interface OnboardingTile {
  id: string;
  color: string;
  state: TileState;
  capabilities: { publish: Capability; dm: Capability; comments: Capability };
}

export function onboardingTiles(
  availability: Record<string, { available: boolean }>,
  opts: { demo: boolean; role: OrgRole }
): OnboardingTile[] {
  return NETWORKS.map((n) => {
    let state: TileState;
    if (opts.demo) state = 'demo';
    else if (opts.role !== 'admin') state = 'admin_only';
    else state = availability[n.id]?.available ? 'connect' : 'unavailable';
    return { id: n.id, color: n.color, state, capabilities: { publish: n.publish, dm: n.dm, comments: n.comments } };
  });
}

export const TILE_HINT_KEY: Record<TileState, MessageKey> = {
  connect: 'app.onboarding.hintConnect',
  demo: 'app.onboarding.hintDemo',
  admin_only: 'app.onboarding.hintAdminOnly',
  unavailable: 'app.onboarding.hintUnavailable',
};

/** URL d'une vidéo de présentation (embed YouTube ou autre), si configurée. N'accepte que https. */
export function tutorialEmbedUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
