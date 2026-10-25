import OpenAI from 'openai';
import { KB } from './types';

/**
 * Les vecteurs des passages et des questions : `text-embedding-3-large` d'OpenAI, réduit à 1024 dimensions (paramètre `dimensions`), même clé que
 * l'agent (`OPENAI_API_KEY`). `OPENAI_EMBEDDING_MODEL` en choisit un autre (`text-embedding-3-small` accepte aussi 1024 dimensions). Changer de modèle
 * change l'espace des vecteurs : les fiches doivent alors être réindexées.
 */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large';
export const embeddingModel = () => process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
/** Sans clé d'API côté serveur, la recherche se fait par les mots seulement. */
export const embeddingsConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());

/** Ce dont la base a besoin du service d'embeddings : un vecteur par texte, dans l'ordre. Remplaçable dans les tests. */
export interface Embedder {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

/** L'embedder du serveur : celui d'OpenAI quand la clé est là, sinon aucun (la recherche se fait alors par les mots seulement). */
export const defaultEmbedder = (): Embedder | null => (embeddingsConfigured() ? sdkEmbedder() : null);

/** Au plus 64 textes par appel. */
const BATCH = 64;

export function sdkEmbedder(make: () => OpenAI = () => new OpenAI({ timeout: 25_000, maxRetries: 2 })): Embedder {
  // Le client n'est créé qu'au premier appel : le SDK refuse de se construire sans clé.
  let client: OpenAI | undefined;
  return {
    async embed(texts, signal) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const res = await (client ??= make()).embeddings.create({ model: embeddingModel(), input: batch, dimensions: KB.dimensions, encoding_format: 'float' }, { signal });
        const sorted = [...res.data].sort((a, b) => a.index - b.index);
        if (sorted.length !== batch.length || sorted.some((d) => d.embedding.length !== KB.dimensions)) throw new Error('embeddings : réponse inattendue');
        out.push(...sorted.map((d) => d.embedding));
      }
      return out;
    },
  };
}
