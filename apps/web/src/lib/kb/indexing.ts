import type { KnowledgeItem, KnowledgeRepository } from '@/lib/data/types';
import { chunkKnowledge } from './chunk';
import type { Embedder } from './embed';
import type { KnowledgeChunkInput } from './types';

export interface IndexResult {
  ok: boolean;
  /** Nombre de passages écrits. */
  chunks: number;
  /** Tous les passages ont leur vecteur : la fiche est cherchable par le sens. Faux : par les mots seulement. */
  embedded: boolean;
}

/**
 * Indexe une fiche : la découpe en passages, vectorise chacun (une seule requête), et remplace ceux de la base. Si le service d'embeddings est absent ou en panne,
 * les passages sont quand même écrits, sans vecteur : la fiche reste cherchable par ses mots et sera revectorisée à la prochaine indexation.
 */
export async function indexItem(
  deps: { knowledge: Pick<KnowledgeRepository, 'replaceChunks'>; embedder: Embedder | null },
  item: Pick<KnowledgeItem, 'id' | 'title' | 'content'>,
  signal?: AbortSignal,
): Promise<IndexResult> {
  const chunks = chunkKnowledge(item.title, item.content);
  let vectors: number[][] | null = null;
  if (deps.embedder && chunks.length > 0) {
    try {
      vectors = await deps.embedder.embed(chunks.map((c) => c.embedText), signal);
      if (vectors.length !== chunks.length) vectors = null;
    } catch (error) {
      console.error('[base de connaissance] vectorisation', error instanceof Error ? error.name : 'erreur inconnue');
    }
  }
  const payload: KnowledgeChunkInput[] = chunks.map((c, i) => ({ content: c.content, embedding: vectors?.[i] ?? null, meta: c.heading ? { heading: c.heading } : {} }));
  const res = await deps.knowledge.replaceChunks(item.id, payload);
  return { ok: res.ok, chunks: res.ok ? payload.length : 0, embedded: res.ok && vectors !== null && payload.length > 0 };
}

/** Indexe les fiches jamais indexées (ou modifiées depuis), `max` au plus par appel. Rend le nombre de fiches traitées. */
export async function indexMissing(
  deps: { knowledge: Pick<KnowledgeRepository, 'replaceChunks'>; embedder: Embedder | null },
  items: readonly KnowledgeItem[],
  max = 10,
  signal?: AbortSignal,
): Promise<number> {
  let done = 0;
  for (const item of items) {
    if (item.indexedAt !== null || done >= max) continue;
    const res = await indexItem(deps, item, signal);
    if (res.ok) done++;
  }
  return done;
}
