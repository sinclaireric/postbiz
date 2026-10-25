import type { AiRequest } from '@/lib/ai/types';
import type { KnowledgeItem, KnowledgeRepository } from '@/lib/data/types';
import type { Embedder } from './embed';
import { NOTHING, retrieve, type Retrieval } from './retrieve';
import type { KnowledgeSplit } from './split';
import { KB, type KnowledgePassage } from './types';

/** Ce que le composeur demande à la base : le sujet pour rédiger, le texte pour l'améliorer, le thème pour les idées. */
export function assistQuery(req: AiRequest): string {
  if (req.mode === 'write') return req.topic;
  if (req.mode === 'improve') return req.text;
  return req.theme;
}

/** Un aperçu de la base quand aucune question ne la guide (idées sans thème) : le début de chaque fiche consultable, les plus récentes d'abord. */
export function overviewPassages(items: readonly KnowledgeItem[], max = KB.searchLimit, chars = 600): KnowledgePassage[] {
  return items
    .filter((i) => i.content.trim())
    .slice(0, max)
    .map((i) => ({ chunkId: `overview:${i.id}`, itemId: i.id, title: i.title, content: i.content.trim().slice(0, chars), heading: null, similarity: 0, termHits: 0, termCount: 0, score: 0 }));
}

/**
 * Les passages de la base à joindre à une demande du composeur : ceux qui répondent au sujet, au texte ou au thème, sans les fiches déjà envoyées en entier.
 * Sans question (idées sans thème), un aperçu de la base. Ne lève jamais : sans passage, la demande continue avec les seules fiches épinglées.
 */
export async function consultForAssist(
  req: AiRequest,
  deps: { knowledge: Pick<KnowledgeRepository, 'search'>; embedder: Embedder | null },
  split: KnowledgeSplit,
  signal?: AbortSignal,
): Promise<{ passages: KnowledgePassage[]; consulted: string[] }> {
  if (split.searchable.length === 0) return { passages: [], consulted: [] };
  const query = assistQuery(req).trim();
  if (!query) {
    const passages = overviewPassages(split.searchable);
    return { passages, consulted: [...new Set(passages.map((p) => p.title))] };
  }
  const found: Retrieval = await retrieve(deps, query, { exclude: split.inPrompt.map((i) => i.id), signal }).catch(() => NOTHING);
  return { passages: found.passages, consulted: found.consulted };
}
