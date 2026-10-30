import { SOURCE_LIMITS } from '../constants.ts';
import { chunkSource } from '../chunk.ts';
import type { Embedder } from '../embed.ts';
import { ExtractError, extractFile } from '../extract/index.ts';
import { previewOf, truncate } from '../text.ts';
import type { KnowledgeChunkInput } from '../types.ts';
import { embedBatches } from './embed.ts';
import { SourceFailure, type SourceStats, type SourceStore } from './types.ts';

export interface FileJob {
  id: string;
  /** Titre de la source : sert de contexte aux passages (vectorisés avec lui). */
  title: string;
  /** Nom d'origine du fichier : son extension dit comment le lire. */
  name: string;
  bytes: Uint8Array;
}

export interface IngestResult {
  chunks: number;
  /** Tous les passages ont leur vecteur. */
  embedded: boolean;
  /** Début du texte, pour la liste des sources. */
  preview: string;
  stats: SourceStats;
}

/**
 * Lit un fichier, le découpe en passages, les vectorise et les écrit. Lève `SourceFailure` (type non pris en charge, trop gros, abîmé, protégé, sans texte). Sans embedder
 * (pas de clé d'API) ou si le service d'embeddings échoue, les passages sont écrits sans vecteur : le fichier reste cherchable par ses mots.
 */
export async function ingestFile(
  deps: { embedder: Embedder | null; store: Pick<SourceStore, 'replaceAll'>; signal?: AbortSignal; wait?: (ms: number) => Promise<void> },
  job: FileJob,
): Promise<IngestResult> {
  let doc;
  try {
    doc = await extractFile(job.bytes, job.name);
  } catch (error) {
    if (error instanceof ExtractError) throw new SourceFailure(error.code, { message: error.message });
    throw error;
  }
  const { chunks, truncated } = chunkSource(job.title, doc.text, SOURCE_LIMITS.maxChunks);
  if (chunks.length === 0) throw new SourceFailure('no_text');
  const vectors = await embedBatches(deps.embedder, chunks.map((c) => c.embedText), { signal: deps.signal, wait: deps.wait });
  const payload: KnowledgeChunkInput[] = chunks.map((c, i) => ({
    content: c.content,
    embedding: vectors[i] ?? null,
    meta: { ...(c.heading ? { heading: truncate(c.heading, 200) } : {}), ...(c.pages ? { pages: c.pages } : {}) },
  }));
  const written = await deps.store.replaceAll(job.id, payload);
  const embedded = payload.every((p) => p.embedding !== null);
  return {
    chunks: written,
    embedded,
    preview: previewOf(doc.text),
    stats: { chunks: written, embedded, truncated: doc.truncated || truncated, ...(doc.pages !== undefined ? { pages: doc.pages } : {}) },
  };
}
