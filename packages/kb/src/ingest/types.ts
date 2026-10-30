import type { SourceErrorCode } from '../constants.ts';
import type { KnowledgeChunkInput } from '../types.ts';

/** Ce qui est dit d'une source une fois lue, enregistré avec elle (`knowledge_items.stats`) : des nombres et des drapeaux, jamais de contenu. */
export interface SourceStats {
  /** Fichier : nombre de pages du document (PDF). */
  pages?: number;
  /** Nombre de passages écrits. */
  chunks?: number;
  /** Tous les passages ont leur vecteur (recherche par le sens) ; faux : par les mots seulement. */
  embedded?: boolean;
  /** Le texte ou le nombre de passages a dépassé la limite : le début seulement est gardé. */
  truncated?: boolean;
  // Sites
  /** Pages lues dans ce passage (réseau), et parmi elles : modifiées (revectorisées), inchangées, en erreur, sans texte lisible. */
  fetched?: number;
  changed?: number;
  unchanged?: number;
  failed?: number;
  /** Pages retirées (disparues du site). */
  removed?: number;
  /** Pages écartées parce que le robots.txt du site le demande. */
  robots?: number;
  /** Pages qui ne s'affichent que par JavaScript (non lues). */
  spa?: number;
  /** La lecture s'est arrêtée à la durée maximale. */
  timeLimit?: boolean;
  /** Pages que le site compte au total dans cette source (lues avant, plus celles de ce passage). */
  total?: number;
}

/** Une source qui n'a pas pu être lue : le code montré à l'utilisateur, et si cela vaut la peine de réessayer plus tard (panne passagère). */
export class SourceFailure extends Error {
  readonly code: SourceErrorCode;
  readonly transient: boolean;
  readonly stats?: SourceStats;
  constructor(code: SourceErrorCode, o: { transient?: boolean; message?: string; stats?: SourceStats } = {}) {
    super(o.message ?? code);
    this.name = 'SourceFailure';
    this.code = code;
    this.transient = o.transient ?? false;
    this.stats = o.stats;
  }
}

/**
 * Ce que l'ingestion écrit dans la base. Le worker l'implémente avec les fonctions SQL `knowledge_source_*` (service_role) ; le mode démo du web, en mémoire.
 */
export interface SourceStore {
  /** Fichier : remplace tous les passages de la source. Rend le nombre de passages écrits. */
  replaceAll(itemId: string, chunks: KnowledgeChunkInput[]): Promise<number>;
  /** Site : les pages déjà lues, par adresse : empreinte du texte, passages et passages vectorisés. */
  pages(itemId: string): Promise<Map<string, { hash: string; chunks: number; embedded: number }>>;
  /** Site : retire les passages des pages `drop` et ajoute `chunks` (ceux des pages modifiées ou nouvelles). Rend le nombre total de passages de la source. */
  applyPages(itemId: string, o: { chunks: KnowledgeChunkInput[]; drop: string[] }): Promise<number>;
  /** Prolonge le verrou de la source : une lecture de site dure plusieurs minutes. */
  touch(itemId: string): Promise<void>;
}

/** Les pannes passagères valent un nouvel essai plus tard ; les autres demandent à l'utilisateur d'agir (autre adresse, autre fichier). */
export const TRANSIENT_ERRORS: ReadonlySet<SourceErrorCode> = new Set<SourceErrorCode>(['dns_failed', 'unreachable', 'timeout', 'tls_error']);
