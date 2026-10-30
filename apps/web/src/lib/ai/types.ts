import type { NetworkId } from '@/lib/inbox/types';

/** Ton demandé à l'assistant. Les libellés sont dans les messages (`app.ai.tone.<ton>`). */
export const AI_TONES = ['professional', 'friendly', 'enthusiastic', 'inspiring', 'humorous', 'direct'] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_LENGTHS = ['short', 'medium', 'long'] as const;
export type AiLength = (typeof AI_LENGTHS)[number];

/** Ce que l'assistant fait d'un texte déjà écrit. */
export const AI_ACTIONS = ['rewrite', 'shorten', 'expand', 'fix', 'tone', 'hashtags', 'adapt'] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

export type AiRequest =
  /** Rédiger : propositions de posts à partir d'un sujet. */
  | { mode: 'write'; topic: string; tone: AiTone; length: AiLength; networkIds: NetworkId[]; useKnowledge: boolean }
  /** Améliorer : reformuler, raccourcir, corriger… le texte en cours. */
  | { mode: 'improve'; action: AiAction; text: string; tone: AiTone; networkIds: NetworkId[]; useKnowledge: boolean }
  /** Idées : posts proposés d'après l'actualité (recherche web) et/ou la base de connaissance. */
  | { mode: 'ideas'; theme: string; news: boolean; knowledge: boolean; tone: AiTone; networkIds: NetworkId[] };

export interface AiProposal {
  text: string;
}

export interface AiIdea {
  /** Titre court de l'idée. */
  title: string;
  /** Pourquoi ce sujet maintenant (une phrase). */
  angle: string;
  /** Texte du post, prêt à insérer. */
  text: string;
  origin: 'news' | 'knowledge';
  /** Source de l'actualité (adresse trouvée par la recherche web, jamais inventée). */
  source: { title: string; url: string } | null;
}

/** `quota` : les actions d'IA texte incluses dans l'offre de l'espace sont toutes utilisées ce mois-ci. */
export type AiErrorCode = 'disabled' | 'forbidden' | 'invalid' | 'rate_limited' | 'refused' | 'empty' | 'failed' | 'quota';

export type AiResult =
  | { ok: true; mode: 'write' | 'improve'; proposals: AiProposal[]; consulted?: string[] }
  | { ok: true; mode: 'ideas'; ideas: AiIdea[]; consulted?: string[] }
  | { ok: false; error: AiErrorCode };

/** Une fiche de la base de connaissance, telle que l'assistant la reçoit. */
export interface KnowledgeEntry {
  title: string;
  content: string;
}
