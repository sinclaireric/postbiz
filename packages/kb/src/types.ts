/** Repères d'un passage, gardés avec lui (`knowledge_chunks.meta`, moins de 4 000 octets). */
export interface ChunkMeta {
  /** Section (intertitre) où se trouve le passage. */
  heading?: string;
  /** Page web d'où vient le passage (sites). */
  url?: string;
  /** Titre de cette page web. */
  title?: string;
  /** Empreinte du texte de la page : à la synchronisation suivante, une page dont l'empreinte est la même n'est pas revectorisée. */
  hash?: string;
  /** Pages du document (PDF) que couvre le passage, de la première à la dernière. */
  pages?: [number, number];
}

/** Un passage prêt à être écrit : son texte, son vecteur (null : le service d'embeddings était indisponible) et ses repères. */
export interface KnowledgeChunkInput {
  content: string;
  embedding: number[] | null;
  meta: ChunkMeta;
}
