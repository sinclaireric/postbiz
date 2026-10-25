/**
 * La base de connaissance cherchable : réglages communs au découpage, à l'indexation et à la recherche. Une fiche (`knowledge_items`) est découpée en
 * passages (`knowledge_chunks`), vectorisés, que l'agent, le composeur et l'inbox retrouvent par leur sens et par leurs mots.
 */
export const KB = {
  /** Dimensions des vecteurs : celles de la colonne `knowledge_chunks.embedding`. Les modèles `text-embedding-3` savent les réduire. */
  dimensions: 1024,
  /** Taille visée d'un passage, en signes (environ 600 jetons) ; un texte plus court reste en un seul passage. */
  chunkChars: 2_400,
  /** Un passage plus court que cela est rattaché à son voisin quand c'est possible. */
  chunkMinChars: 400,
  /** Reprise de la fin du passage précédent quand un paragraphe est coupé en plusieurs. */
  overlapChars: 200,
  /** Plafond de la base : 40 passages par fiche (voir `knowledge_replace_chunks`). */
  maxChunksPerItem: 40,
  /** Passages rendus par une recherche, dont au plus `perItem` d'une même fiche. */
  searchLimit: 6,
  perItem: 3,
  /** Longueur de la question envoyée à la recherche. */
  queryChars: 800,
  /** Part du prompt réservée aux passages retrouvés (en signes). */
  promptChars: 12_000,
  /** Mots de la question comptés pour la recherche par les mots. */
  maxTerms: 12,
} as const;

/** Un passage prêt à être écrit : son texte, son vecteur (null : le service d'embeddings était indisponible) et ses repères. */
export interface KnowledgeChunkInput {
  content: string;
  embedding: number[] | null;
  meta: { heading?: string };
}

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
  /** Similarité cosinus avec la question (0 : pas dans les meilleurs par le sens, ou recherche par les mots seulement). */
  similarity: number;
  /** Combien de mots de la question le passage contient. */
  termHits: number;
  /** Rang fusionné (sens et mots) : plus grand, meilleur. */
  score: number;
}

/** Un passage retenu pour une demande : un `KnowledgeHit` jugé pertinent. */
export type KnowledgePassage = KnowledgeHit & { termCount: number };
