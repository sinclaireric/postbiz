import { KNOWLEDGE_BUDGET, knowledgeEntrySize } from '@/lib/ai/prompt';
import type { KnowledgeItem } from '@/lib/data/types';

export interface KnowledgeSplit {
  /** Fiches épinglées envoyées en entier à l'IA (dans la limite du budget). */
  inPrompt: KnowledgeItem[];
  /** Fiches épinglées qui ne tiennent plus dans le budget : elles ne sont plus envoyées en entier, on les cherche comme les autres. */
  overflow: KnowledgeItem[];
  /** Fiches consultées par la recherche : celles qui ne sont pas épinglées, plus celles qui ne tiennent pas dans le budget. */
  searchable: KnowledgeItem[];
  /** Taille des fiches épinglées, en signes, comptée comme le prompt les compte. */
  pinnedChars: number;
}

/**
 * Répartit les fiches (du plus récent au plus ancien) : les épinglées sont envoyées en entier tant qu'elles tiennent dans `KNOWLEDGE_BUDGET`, comme
 * `knowledgeBlock` les compte ; à la première qui ne tient plus, celle-ci et les suivantes passent du côté de la recherche. Rien n'est écarté en silence.
 */
export function splitKnowledge(items: readonly KnowledgeItem[], budget: number = KNOWLEDGE_BUDGET): KnowledgeSplit {
  const inPrompt: KnowledgeItem[] = [];
  const overflow: KnowledgeItem[] = [];
  const searchable: KnowledgeItem[] = [];
  let used = 0;
  let full = false;
  for (const item of items) {
    if (!item.pinned) {
      searchable.push(item);
      continue;
    }
    const size = knowledgeEntrySize(item);
    if (!full && used + size <= budget) {
      inPrompt.push(item);
      used += size;
    } else {
      full = true;
      overflow.push(item);
      searchable.push(item);
    }
  }
  return { inPrompt, overflow, searchable, pinnedChars: used };
}
