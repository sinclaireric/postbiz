import type { Env } from '@postbiz/core';
import { createFacebookProvider } from './facebook.ts';
import { createInstagramProvider } from './instagram.ts';
import { createLinkedInProvider } from './linkedin.ts';
import { createTikTokProvider } from './tiktok.ts';
import type { PublishResult, SocialProvider } from './types.ts';
import { createXProvider } from './x.ts';
import { createYouTubeProvider } from './youtube.ts';

/** Fournisseur d'essai : ne contacte aucun réseau. Activé par WORKER_DRY_RUN=1. */
export const dryRunProvider = (id: string): SocialProvider => ({
  id,
  supportsThreads: true,
  supportsMedia: true,
  async publish({ posts }): Promise<PublishResult[]> {
    return posts.map((p) => ({ releaseId: `dry-run-${p.id}`, releaseUrl: null }));
  },
  async comment({ releaseId }) {
    return { commentId: `dry-run-comment-${releaseId}` };
  },
});

export type ProviderRegistry = (networkId: string) => SocialProvider | null;

export function createRegistry(opts: { dryRun: boolean; fetch?: typeof fetch; env?: Env }): ProviderRegistry {
  if (opts.dryRun) return (id) => dryRunProvider(id);
  const real: Record<string, SocialProvider> = {
    facebook: createFacebookProvider(opts.fetch),
    x: createXProvider(opts.fetch, opts.env),
    linkedin: createLinkedInProvider(opts.fetch, opts.env),
    // Page LinkedIn : même API de publication (l'auteur est l'organisation, settings.author_urn), mais une autre application LinkedIn.
    linkedin_page: createLinkedInProvider(opts.fetch, opts.env, 'linkedin_page'),
    // Connexion et rafraîchissement des jetons : oui. Publication : refusée avec un message clair (vidéo exigée).
    youtube: createYouTubeProvider(opts.fetch, opts.env),
    tiktok: createTikTokProvider(opts.fetch, opts.env),
    // Instagram : connexion et prolongation du jeton (Instagram Login) oui ; publication refusée avec un message clair (média exigé).
    instagram: createInstagramProvider(opts.fetch, opts.env),
  };
  return (id) => real[id] ?? null;
}
