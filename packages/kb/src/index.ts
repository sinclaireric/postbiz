// Partie légère du paquet (aucune dépendance lourde) : constantes, types, texte, découpage. Les embeddings (`@postbiz/kb/embed`), le réseau protégé
// (`@postbiz/kb/net`), les lecteurs de fichiers (`@postbiz/kb/extract`) et l'ingestion (`@postbiz/kb/ingest`) s'importent à part.
export * from './constants.ts';
export * from './types.ts';
export * from './text.ts';
export * from './chunk.ts';
