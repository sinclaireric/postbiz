import type { KnowledgeRepository } from '@/lib/data/types';
import type { Embedder } from './embed';
import { queryTerms } from './terms';
import { KB, type KnowledgeHit, type KnowledgePassage } from './types';

/**
 * Seuils de pertinence. Les vecteurs d'`text-embedding-3` donnent environ 0,3 à 0,6 pour un passage qui répond à la question et moins de 0,2 pour un
 * passage sans rapport ; ces seuils sont une première estimation à calibrer avec de vrais passages et de vraies questions (voir `retrieve.test.ts`
 * pour ce que le code garantit, pas la valeur des seuils).
 */
export const RELEVANCE = {
  minSimilarity: 0.25,
  /** Par les mots : au moins deux mots de la question (un seul si elle n'en a qu'un), et près d'un tiers d'entre eux. */
  minTermHits: 2,
  minTermShare: 0.3,
} as const;

export interface Retrieval {
  /** Les passages pertinents, du meilleur au moins bon. */
  passages: KnowledgePassage[];
  /** Tous les passages rendus par la base, pertinents ou non (pour le test de la page Connaissances). */
  all: (KnowledgePassage & { relevant: boolean })[];
  found: boolean;
  /** `hybrid` : sens et mots ; `words` : les mots seulement (pas de clé d'API, ou le service d'embeddings a échoué). */
  mode: 'hybrid' | 'words';
  /** Titres des fiches dont viennent les passages pertinents, sans doublon. */
  consulted: string[];
}

export const NOTHING: Retrieval = { passages: [], all: [], found: false, mode: 'words', consulted: [] };

export function isRelevant(hit: Pick<KnowledgeHit, 'similarity' | 'termHits'>, termCount: number, embedded: boolean): boolean {
  if (embedded && hit.similarity >= RELEVANCE.minSimilarity) return true;
  if (termCount === 0) return false;
  return hit.termHits >= Math.min(RELEVANCE.minTermHits, termCount) && hit.termHits / termCount >= RELEVANCE.minTermShare;
}

/**
 * Cherche dans la base ce qui répond à `query` : vecteur de la question (si possible) et mots, passages écartés s'ils ne sont pas pertinents.
 * Ne lève jamais : un service d'embeddings en panne ou une base qui ne répond pas donnent « rien trouvé », la demande de l'utilisateur continue sans la base.
 */
export async function retrieve(
  deps: { knowledge: Pick<KnowledgeRepository, 'search'>; embedder: Embedder | null },
  query: string,
  opts: { exclude?: string[]; limit?: number; signal?: AbortSignal } = {},
): Promise<Retrieval> {
  const text = query.replace(/\s+/g, ' ').trim().slice(0, KB.queryChars);
  if (!text) return NOTHING;
  const terms = queryTerms(text);

  let embedding: number[] | null = null;
  if (deps.embedder) {
    try {
      embedding = (await deps.embedder.embed([text], opts.signal))[0] ?? null;
    } catch (error) {
      // Le détail reste dans les journaux, sans le texte de la question.
      console.error('[base de connaissance] embedding', error instanceof Error ? error.name : 'erreur inconnue');
    }
  }

  let hits: KnowledgeHit[];
  try {
    hits = await deps.knowledge.search({ embedding, terms, limit: opts.limit ?? KB.searchLimit, perItem: KB.perItem, exclude: opts.exclude ?? [] });
  } catch (error) {
    console.error('[base de connaissance] recherche', error instanceof Error ? error.name : 'erreur inconnue');
    return NOTHING;
  }

  const all = hits.map((h) => ({ ...h, termCount: terms.length, relevant: isRelevant(h, terms.length, embedding !== null) }));
  const passages = all.filter((h) => h.relevant).map(({ relevant: _relevant, ...passage }): KnowledgePassage => passage);
  return { passages, all, found: passages.length > 0, mode: embedding ? 'hybrid' : 'words', consulted: [...new Set(passages.map((p) => p.title))] };
}
