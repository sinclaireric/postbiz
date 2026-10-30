import type { SourceErrorCode } from '../constants.ts';

/** Un fichier qu'on ne peut pas lire, avec la raison à montrer à l'utilisateur (voir `SOURCE_ERRORS`). */
export class ExtractError extends Error {
  readonly code: Extract<SourceErrorCode, 'unsupported_type' | 'too_large' | 'corrupt' | 'encrypted' | 'no_text'>;
  constructor(code: ExtractError['code'], message?: string) {
    super(message ?? code);
    this.name = 'ExtractError';
    this.code = code;
  }
}

/** Ce que donne la lecture d'un fichier : le texte (intertitres en « # », pages d'un PDF séparées par U+000C), et ce qui a été écarté. */
export interface ExtractedDocument {
  text: string;
  /** Nombre de pages (PDF). */
  pages?: number;
  /** Le texte a été coupé : le document est plus long que `SOURCE_LIMITS.textChars` (ou a plus de pages que lues). */
  truncated: boolean;
}
