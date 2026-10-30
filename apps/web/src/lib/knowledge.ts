import type { FormError } from '@/lib/form-error';
import { KNOWLEDGE_LIMITS, type KnowledgeInput } from '@/lib/data/types';

/** Titre et contenu tels qu'on les garde : titre sur une ligne, contenu sans lignes vides en trop. */
export function normalizeKnowledge(title: unknown, content: unknown): KnowledgeInput {
  return {
    title: String(title ?? '').replace(/\s+/g, ' ').trim(),
    content: String(content ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

/** Erreur de validation d'une fiche (clé de message), ou null. `count` : nombre de sources déjà enregistrées, pour une création ; `max` : le plafond de l'offre (par défaut, celui de la bêta). */
export function validateKnowledge(input: KnowledgeInput, count?: number, max: number = KNOWLEDGE_LIMITS.items): FormError | null {
  if (!input.title || !input.content) return { key: 'app.knowledge.errInvalid', params: { title: KNOWLEDGE_LIMITS.title, content: KNOWLEDGE_LIMITS.content } };
  if ([...input.title].length > KNOWLEDGE_LIMITS.title || [...input.content].length > KNOWLEDGE_LIMITS.content) {
    return { key: 'app.knowledge.errInvalid', params: { title: KNOWLEDGE_LIMITS.title, content: KNOWLEDGE_LIMITS.content } };
  }
  if (count !== undefined && count >= max) return { key: 'app.knowledge.errLimit', params: { max } };
  return null;
}
