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
  name: string;
  color: string;
  state: TileState;
  note?: string;
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
    return { id: n.id, name: n.name, color: n.color, state, note: n.note, capabilities: { publish: n.publish, dm: n.dm, comments: n.comments } };
  });
}

export const TILE_HINT: Record<TileState, string> = {
  connect: 'Cliquez pour connecter ce canal.',
  demo: 'Mode démo : la connexion est simulée.',
  admin_only: 'Seul un administrateur de l’organisation peut connecter un canal.',
  unavailable: 'Connexion indisponible : les clés API de ce réseau ne sont pas encore configurées sur ce serveur (voir docs/RESEAUX.md).',
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
