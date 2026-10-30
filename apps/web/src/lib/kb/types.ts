/**
 * La base de connaissance cherchable : réglages communs au découpage, à l'indexation et à la recherche (dans le paquet partagé `@postbiz/kb`, que le worker
 * utilise aussi). Une fiche (`knowledge_items`) est découpée en passages (`knowledge_chunks`), vectorisés, que l'agent, le composeur et l'inbox retrouvent
 * par leur sens et par leurs mots.
 */
export { KB, type ChunkMeta, type KnowledgeChunkInput } from '@postbiz/kb';

/** Une recherche dans la base (voir `knowledge_search`). */
export interface KnowledgeSearchQuery {
  /** Vecteur de la question ; null : recherche par les mots seulement. */
  embedding: number[] | null;
  terms: string[];
  limit: number;
  perItem: number;
  /** Fiches à écarter (celles qui sont déjà envoyées en entier à l'IA). */
  exclude: string[];
}

/** Ce que rend la base pour un passage : texte, fiche d'origine et mesures de pertinence. */
export interface KnowledgeHit {
  chunkId: string;
  itemId: string;
  title: string;
  content: string;
  heading: string | null;
  /** Page web d'où vient le passage (site), son titre, ou pages du document (PDF) : de quoi citer la source. */
  url?: string | null;
  pageTitle?: string | null;
  pages?: [number, number] | null;
  /** Similarité cosinus avec la question (0 : pas dans les meilleurs par le sens, ou recherche par les mots seulement). */
  similarity: number;
  /** Combien de mots de la question le passage contient. */
  termHits: number;
  /** Rang fusionné (sens et mots) : plus grand, meilleur. */
  score: number;
}

/** Un passage retenu pour une demande : un `KnowledgeHit` jugé pertinent. */
export type KnowledgePassage = KnowledgeHit & { termCount: number };
