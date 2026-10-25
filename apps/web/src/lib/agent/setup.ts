import type { Repositories } from '@/lib/data/types';
import { imagesPerDay, videoConfigured, videosPerDay } from './config';
import { demoFetch, demoImageProvider, demoVideoProvider } from './demo';
import { evolinkVideoProvider, sdkImageProvider } from './generate';
import type { GenerationDeps } from './generation';
import type { AgentFeatures } from './prompt';

/**
 * Ce que l'agent peut générer sur ce serveur, et avec quels fournisseurs : les images avec la clé OpenAI de l'agent, les vidéos avec une clé Evolink
 * (Seedance), chacune avec son plafond journalier (0 : désactivé). En mode démo, les fournisseurs sont simulés : aucun appel n'est fait.
 */
export function generationSetup(o: { demo: boolean; repos: Pick<Repositories, 'generation' | 'media'>; signal?: AbortSignal; deadline?: number }): { features: AgentFeatures; deps: GenerationDeps } {
  const { repos, signal, deadline } = o;
  if (o.demo) {
    return {
      features: { image: true, video: true },
      deps: { repos, images: demoImageProvider(), videos: demoVideoProvider(), limits: { imagesPerDay: 30, videosPerDay: 5 }, fetcher: demoFetch, signal, deadline },
    };
  }
  const limits = { imagesPerDay: imagesPerDay(), videosPerDay: videosPerDay() };
  const features: AgentFeatures = { image: limits.imagesPerDay > 0, video: videoConfigured() && limits.videosPerDay > 0 };
  return { features, deps: { repos, images: features.image ? sdkImageProvider() : null, videos: features.video ? evolinkVideoProvider() : null, limits, signal, deadline } };
}
