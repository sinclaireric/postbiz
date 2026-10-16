import { createFacebookProvider } from './facebook.ts';
import { createLinkedInProvider } from './linkedin.ts';
import type { PublishResult, SocialProvider } from './types.ts';
import { createXProvider } from './x.ts';

/** Fournisseur d'essai : ne contacte aucun réseau. Activé par WORKER_DRY_RUN=1. */
export const dryRunProvider = (id: string): SocialProvider => ({
  id,
  supportsThreads: true,
  supportsMedia: true,
  async publish({ posts }): Promise<PublishResult[]> {
    return posts.map((p) => ({ releaseId: `dry-run-${p.id}`, releaseUrl: null }));
  },
});

export type ProviderRegistry = (networkId: string) => SocialProvider | null;

export function createRegistry(opts: { dryRun: boolean; fetch?: typeof fetch }): ProviderRegistry {
  if (opts.dryRun) return (id) => dryRunProvider(id);
  const real: Record<string, SocialProvider> = {
    facebook: createFacebookProvider(opts.fetch),
    x: createXProvider(opts.fetch),
    linkedin: createLinkedInProvider(opts.fetch),
    // instagram, tiktok, youtube : exigent un média (téléversement non encore implémenté).
  };
  return (id) => real[id] ?? null;
}
