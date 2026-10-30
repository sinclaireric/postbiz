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
  /** Plafond d'une fiche de texte : 40 passages (voir `knowledge_replace_chunks`). Les documents et les sites ont `SOURCE_LIMITS.maxChunks`. */
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

/** Limites des documents et des sites web : les mêmes que dans la base (migration `knowledge_sources`). */
export const SOURCE_LIMITS = {
  /** Taille d'un fichier envoyé (le bucket `knowledge` applique la même). */
  fileBytes: 10 * 1024 * 1024,
  /** Texte tiré d'un fichier, au plus : le reste est ignoré (la source est alors marquée « tronquée »). */
  textChars: 1_500_000,
  /** Passages d'un fichier ou d'un site. */
  maxChunks: 400,
  /** Pages lues d'un site. */
  sitePages: 50,
  /** Taille d'une page web lue (décompressée). */
  pageBytes: 1024 * 1024,
  /** Durée maximale d'une lecture de site, et durée maximale d'une requête. */
  crawlSeconds: 600,
  requestSeconds: 15,
  /** Délai entre deux requêtes au même site (le `Crawl-delay` de son robots.txt l'emporte s'il est plus long, jusqu'à 10 s). */
  crawlDelayMs: 700,
  /** Fichiers et sites par organisation (et 100 sources en tout, fiches de texte comprises). */
  files: 40,
  sites: 5,
  /** Ajouts (fichiers et sites) par organisation et par jour. */
  addsPerDay: 30,
  /** Délai entre deux « Actualiser » à la main. */
  manualSyncMinutes: 10,
  /** Un site est relu toutes les semaines. */
  autoSyncDays: 7,
} as const;

/** Les fichiers acceptés : extension → type MIME. Le bucket `knowledge` n'accepte que ces types. */
export const FILE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
} as const;
export type FileExtension = keyof typeof FILE_TYPES;
/** Pour l'attribut `accept` d'un champ de fichier. */
export const FILE_ACCEPT = Object.keys(FILE_TYPES).map((ext) => `.${ext}`).join(',');

/** L'extension reconnue d'un nom de fichier, ou null. */
export function fileExtension(name: string): FileExtension | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  const ext = m?.[1]?.toLowerCase();
  return ext && Object.prototype.hasOwnProperty.call(FILE_TYPES, ext) ? (ext as FileExtension) : null;
}

/**
 * Pourquoi une source n'a pas pu être lue. Enregistré tel quel dans `knowledge_items.error` ; la page l'affiche dans la langue de l'utilisateur
 * (`app.knowledgePage.sources.errors.<code>`), jamais le texte d'une exception.
 */
export const SOURCE_ERRORS = [
  // fichiers
  'unsupported_type', 'too_large', 'file_missing', 'corrupt', 'encrypted', 'no_text',
  // sites
  'invalid_url', 'blocked_address', 'dns_failed', 'unreachable', 'timeout', 'tls_error', 'http_error', 'not_html', 'robots_disallowed', 'redirect_loop', 'empty_site',
  // les deux
  'internal',
] as const;
export type SourceErrorCode = (typeof SOURCE_ERRORS)[number];
export const isSourceError = (code: unknown): code is SourceErrorCode => typeof code === 'string' && (SOURCE_ERRORS as readonly string[]).includes(code);
